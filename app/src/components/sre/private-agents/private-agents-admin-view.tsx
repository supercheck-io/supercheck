"use client";

import { useState, useTransition } from "react";
import {
  Copy,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Plus,
  RadioTower,
} from "lucide-react";
import { toast } from "sonner";

import {
  disablePrivateAgent,
  rotatePrivateAgentToken,
  type PrivateAgentListItem,
} from "@/actions/private-agents";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { PrivateAgentFormDialog } from "@/components/sre/private-agents/private-agent-form-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PrivateAgentsAdminViewProps = {
  initialAgents: PrivateAgentListItem[];
  loadError: string | null;
};

const statusTones: Record<PrivateAgentListItem["status"], TableBadgeTone> = {
  pending: "info",
  connected: "success",
  disconnected: "warning",
  unhealthy: "danger",
  disabled: "slate",
};

function formatDate(value: Date | string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function PrivateAgentsAdminView({
  initialAgents,
  loadError,
}: PrivateAgentsAdminViewProps) {
  const [agents, setAgents] = useState(initialAgents);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [disablingAgent, setDisablingAgent] =
    useState<PrivateAgentListItem | null>(null);
  const [rotatedToken, setRotatedToken] = useState<{
    agent: PrivateAgentListItem;
    token: string;
  } | null>(null);
  const [isMutating, startMutationTransition] = useTransition();

  const handleSaved = (savedAgent: PrivateAgentListItem) => {
    setAgents((current) => {
      const exists = current.some((agent) => agent.id === savedAgent.id);
      if (exists) {
        return current.map((agent) =>
          agent.id === savedAgent.id ? savedAgent : agent,
        );
      }
      return [savedAgent, ...current];
    });
  };

  const confirmDisable = () => {
    if (!disablingAgent) return;

    startMutationTransition(async () => {
      const result = await disablePrivateAgent({ id: disablingAgent.id });
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      handleSaved(result.agent);
      toast.success(result.message);
      setDisablingAgent(null);
    });
  };

  const rotateToken = (agent: PrivateAgentListItem) => {
    startMutationTransition(async () => {
      const result = await rotatePrivateAgentToken({ id: agent.id });
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      handleSaved(result.agent);
      if (result.registrationToken) {
        setRotatedToken({
          agent: result.agent,
          token: result.registrationToken,
        });
      }
      toast.success(result.message);
    });
  };

  const copyRotatedToken = async () => {
    if (!rotatedToken) return;
    await navigator.clipboard.writeText(rotatedToken.token);
    toast.success("Registration token copied");
  };

  const copyAgentId = async (agentId: string) => {
    await navigator.clipboard.writeText(agentId);
    toast.success("Agent ID copied");
  };

  if (loadError) {
    return (
      <DashboardEmptyState
        className="min-h-[420px]"
        title="Private Agents unavailable"
        description={loadError}
        icon={<RadioTower className="h-10 w-10" />}
      />
    );
  }

  return (
    <div className="space-y-4">
      {agents.length === 0 ? (
        <DashboardEmptyState
          className="min-h-[420px]"
          title="No Private Agents registered"
          description="Register a Private Agent before configuring private-network connectors in cloud deployments."
          icon={<KeyRound className="h-10 w-10" />}
          action={
            <Button onClick={() => setIsRegisterOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Register agent
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setIsRegisterOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Register agent
            </Button>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Network</TableHead>
                  <TableHead>Last heartbeat</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell className="min-w-[240px] whitespace-normal">
                      <div className="space-y-1">
                        <p className="font-medium">{agent.name}</p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <code>{agent.id}</code>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            aria-label={`Copy Agent ID for ${agent.name}`}
                            onClick={() => copyAgentId(agent.id)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {agent.version ?? "Version not reported"}
                        </p>
                        {agent.lastError && (
                          <p className="text-xs text-destructive">
                            {agent.lastError}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <TableBadge
                        tone={statusTones[agent.status]}
                        compact
                        className="capitalize"
                      >
                        {agent.status}
                      </TableBadge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1 text-sm">
                        <p>{agent.region ?? "No region"}</p>
                        <p className="text-xs text-muted-foreground">
                          {agent.networkLabel ?? "No network label"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell suppressHydrationWarning>
                      {formatDate(agent.lastHeartbeatAt)}
                    </TableCell>
                    <TableCell>
                      {agent.projectScoped ? "Current project" : "Organization"}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Open actions for ${agent.name}`}
                            disabled={isMutating}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {agent.status !== "disabled" && (
                            <>
                              <DropdownMenuItem
                                onClick={() => rotateToken(agent)}
                              >
                                Rotate token
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDisablingAgent(agent)}
                              >
                                Disable agent
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {isRegisterOpen && (
        <PrivateAgentFormDialog
          open={isRegisterOpen}
          onOpenChange={setIsRegisterOpen}
          onSaved={handleSaved}
        />
      )}

      <AlertDialog
        open={Boolean(disablingAgent)}
        onOpenChange={(open) => !open && setDisablingAgent(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable Private Agent?</AlertDialogTitle>
            <AlertDialogDescription>
              {disablingAgent?.name} will stop receiving connector jobs. Active
              credentials are revoked, and existing audit history is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDisable} disabled={isMutating}>
              {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Disable agent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={Boolean(rotatedToken)}
        onOpenChange={(open) => !open && setRotatedToken(null)}
      >
        <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl gap-3 p-5 sm:w-full">
          <DialogHeader>
            <DialogTitle>Token rotated</DialogTitle>
            <DialogDescription>
              Copy the new token for {rotatedToken?.agent.name}. It will not be
              shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              value={rotatedToken?.token ?? ""}
              readOnly
              className="font-mono text-xs"
            />
            <Button type="button" variant="outline" onClick={copyRotatedToken}>
              Copy
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setRotatedToken(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
