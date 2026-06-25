"use client";

import { useState, useTransition } from "react";
import { KeyRound, Loader2, MoreHorizontal, Plus, RadioTower } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

type PrivateAgentsAdminViewProps = {
  initialAgents: PrivateAgentListItem[];
  loadError: string | null;
};

const statusClasses: Record<PrivateAgentListItem["status"], string> = {
  pending: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
  connected: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  disconnected: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  unhealthy: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
  disabled: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
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

export function PrivateAgentsAdminView({ initialAgents, loadError }: PrivateAgentsAdminViewProps) {
  const [agents, setAgents] = useState(initialAgents);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [disablingAgent, setDisablingAgent] = useState<PrivateAgentListItem | null>(null);
  const [rotatedToken, setRotatedToken] = useState<{ agent: PrivateAgentListItem; token: string } | null>(null);
  const [isMutating, startMutationTransition] = useTransition();

  const handleSaved = (savedAgent: PrivateAgentListItem) => {
    setAgents((current) => {
      const exists = current.some((agent) => agent.id === savedAgent.id);
      if (exists) {
        return current.map((agent) => (agent.id === savedAgent.id ? savedAgent : agent));
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
        setRotatedToken({ agent: result.agent, token: result.registrationToken });
      }
      toast.success(result.message);
    });
  };

  const copyRotatedToken = async () => {
    if (!rotatedToken) return;
    await navigator.clipboard.writeText(rotatedToken.token);
    toast.success("Registration token copied");
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
    <div className="space-y-4 pt-6">
      <div className="mb-4 -mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col">
          <h2 className="text-2xl font-semibold">Private Agents</h2>
          <p className="text-sm text-muted-foreground">
            Manage agents that route read-only connector queries into private networks
          </p>
        </div>
        <Button onClick={() => setIsRegisterOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Register agent
        </Button>
      </div>

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
                      <p className="text-xs text-muted-foreground">{agent.version ?? "Version not reported"}</p>
                      {agent.lastError && <p className="text-xs text-destructive">{agent.lastError}</p>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("capitalize", statusClasses[agent.status])}>
                      {agent.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1 text-sm">
                      <p>{agent.region ?? "No region"}</p>
                      <p className="text-xs text-muted-foreground">{agent.networkLabel ?? "No network label"}</p>
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(agent.lastHeartbeatAt)}</TableCell>
                  <TableCell>{agent.projectScoped ? "Current project" : "Organization"}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Open actions for ${agent.name}`} disabled={isMutating}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {agent.status !== "disabled" && (
                          <>
                            <DropdownMenuItem onClick={() => rotateToken(agent)}>Rotate token</DropdownMenuItem>
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
      )}

      {isRegisterOpen && (
        <PrivateAgentFormDialog open={isRegisterOpen} onOpenChange={setIsRegisterOpen} onSaved={handleSaved} />
      )}

      <AlertDialog open={Boolean(disablingAgent)} onOpenChange={(open) => !open && setDisablingAgent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable Private Agent?</AlertDialogTitle>
            <AlertDialogDescription>
              {disablingAgent?.name} will stop receiving connector jobs. Active credentials are revoked, and existing audit history is preserved.
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

      <Dialog open={Boolean(rotatedToken)} onOpenChange={(open) => !open && setRotatedToken(null)}>
        <DialogContent className="max-w-2xl min-w-2xl gap-3 p-5">
          <DialogHeader>
            <DialogTitle>Token rotated</DialogTitle>
            <DialogDescription>
              Copy the new token for {rotatedToken?.agent.name}. It will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input value={rotatedToken?.token ?? ""} readOnly className="font-mono text-xs" />
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
