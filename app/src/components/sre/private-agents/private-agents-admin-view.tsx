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
import { copyToClipboard } from "./copy-to-clipboard";

import {
  disablePrivateAgent,
  rotatePrivateAgentToken,
  type PrivateAgentListItem,
} from "@/actions/private-agents";
import { ListPagination } from "@/components/admin/list-pagination";
import { repaginate, useFitPageSize } from "@/hooks/use-fit-page-size";
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
  /** Called after an agent is created, changed, or disabled so connector options can refresh. */
  onSetupChanged?: () => void;
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
  onSetupChanged,
}: PrivateAgentsAdminViewProps) {
  const [agents, setAgents] = useState(initialAgents);
  const { bodyRef, pageSize, setPageSize } = useFitPageSize();
  const [page, setPage] = useState({ index: 0, size: pageSize });
  // Auto-fit changes the size outside the table, so carry the page across here.
  if (page.size !== pageSize) {
    setPage({
      index: repaginate(page.index, page.size, pageSize, agents.length),
      size: pageSize,
    });
  }
  const pageCount = Math.max(1, Math.ceil(agents.length / pageSize));
  const pageIndex = Math.min(page.index, pageCount - 1);
  const pageAgents = agents.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [disablingAgent, setDisablingAgent] =
    useState<PrivateAgentListItem | null>(null);
  const [rotatedToken, setRotatedToken] = useState<{
    agent: PrivateAgentListItem;
    token: string;
  } | null>(null);
  const [rotatingAgent, setRotatingAgent] =
    useState<PrivateAgentListItem | null>(null);
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
    onSetupChanged?.();
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
      setRotatingAgent(null);
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
    await copyToClipboard(rotatedToken.token, "Registration token");
  };

  const copyAgentId = async (agentId: string) => {
    await copyToClipboard(agentId, "Agent ID");
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
      {agents.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={() => setIsRegisterOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Register agent
          </Button>
        </div>
      )}
      {agents.length === 0 ? (
        <DashboardEmptyState
          className="min-h-[420px]"
          title="No Private Agents registered"
          description="Register a Private Agent to run connectors inside your private network without exposing it."
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
          <div className="relative max-w-full overflow-x-auto rounded-t-lg border">
            <Table className="w-full min-w-[900px]">
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
              <TableBody ref={bodyRef}>
                {pageAgents.map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell className="min-w-[240px] whitespace-normal py-2.5">
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
                    <TableCell className="py-2.5">
                      <TableBadge
                        tone={statusTones[agent.status]}
                        compact
                        className="capitalize"
                      >
                        {agent.status}
                      </TableBadge>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <div className="space-y-1 text-sm">
                        <p>{agent.region ?? "No region"}</p>
                        <p className="text-xs text-muted-foreground">
                          {agent.networkLabel ?? "No network label"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5" suppressHydrationWarning>
                      {formatDate(agent.lastHeartbeatAt)}
                    </TableCell>
                    <TableCell className="py-2.5">
                      {agent.projectScoped ? "Current project" : "Organization"}
                    </TableCell>
                    <TableCell className="py-2.5">
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
                                onClick={() => setRotatingAgent(agent)}
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
          <ListPagination
            total={agents.length}
            itemName="agents"
            pageIndex={pageIndex}
            pageSize={pageSize}
            pageCount={pageCount}
            onPageChange={(index) => setPage({ index, size: pageSize })}
            onPageSizeChange={setPageSize}
          />
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
        open={Boolean(rotatingAgent)}
        onOpenChange={(open) => !open && !isMutating && setRotatingAgent(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate registration token?</AlertDialogTitle>
            <AlertDialogDescription>
              A new one-time token for {rotatingAgent?.name} is shown once. The
              agent must be restarted with it to reconnect, so jobs stop until
              you do.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (rotatingAgent) rotateToken(rotatingAgent);
              }}
              disabled={isMutating}
            >
              {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Rotate token
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(disablingAgent)}
        onOpenChange={(open) => !open && setDisablingAgent(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable Private Agent?</AlertDialogTitle>
            <AlertDialogDescription>
              {disablingAgent?.name} will stop receiving connector jobs. Active
              credentials are revoked, connectors bound to this agent will fail
              until reassigned, and audit history is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                confirmDisable();
              }}
              disabled={isMutating}
            >
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
