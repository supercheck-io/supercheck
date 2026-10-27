"use client";

import { useState, useTransition } from "react";
import { KeyRound, Loader2, Plus, RadioTower } from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard } from "./copy-to-clipboard";

import {
  disablePrivateAgent,
  rotatePrivateAgentToken,
  type PrivateAgentListItem,
} from "@/actions/private-agents";
import { DataTable } from "@/components/sre/data-table/data-table";
import { columns } from "@/components/sre/data-table/private-agents/columns";
import { PrivateAgentsToolbar } from "@/components/sre/data-table/private-agents/toolbar";
import { PrivateAgentDetailsDialog } from "@/components/sre/private-agents/private-agent-details-dialog";
import type { SreConnectorListItem } from "@/actions/sre-connectors";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PrivateAgentsAdminViewProps = {
  initialAgents: PrivateAgentListItem[];
  loadError: string | null;
  /** Connectors already loaded on the Integrations tab, for the details dialog. */
  connectors?: SreConnectorListItem[];
  /** Called after an agent is created, changed, or disabled so connector options can refresh. */
  onSetupChanged?: () => void;
};

export function PrivateAgentsAdminView({
  initialAgents,
  loadError,
  connectors,
  onSetupChanged,
}: PrivateAgentsAdminViewProps) {
  const [agents, setAgents] = useState(initialAgents);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [disablingAgent, setDisablingAgent] =
    useState<PrivateAgentListItem | null>(null);
  const [rotatedToken, setRotatedToken] = useState<{
    agent: PrivateAgentListItem;
    token: string;
  } | null>(null);
  const [rotatingAgent, setRotatingAgent] =
    useState<PrivateAgentListItem | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;
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
        <DataTable
          columns={columns}
          data={agents}
          entityLabel="agents"
          renderToolbar={(table) => (
            <PrivateAgentsToolbar
              table={table}
              onRegister={() => setIsRegisterOpen(true)}
            />
          )}
          onRowClick={(row) => setSelectedAgentId(row.original.id)}
          meta={{
            onRotate: setRotatingAgent,
            onDisable: setDisablingAgent,
            isMutating,
            globalFilterColumns: [
              "id",
              "name",
              "status",
              "version",
              "region",
              "networkLabel",
            ],
          }}
        />
      )}

      <PrivateAgentDetailsDialog
        agent={selectedAgent}
        connectors={connectors}
        onOpenChange={(open) => !open && setSelectedAgentId(null)}
      />

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
