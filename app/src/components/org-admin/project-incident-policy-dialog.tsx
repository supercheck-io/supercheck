"use client";

import * as React from "react";
import { AlertCircle, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  getProjectNotificationPolicy,
  saveProjectNotificationPolicy,
  type PolicyChannel,
} from "@/actions/notification-policy";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface ProjectIncidentPolicyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
}

export function ProjectIncidentPolicyDialog({ open, onOpenChange, projectId, projectName }: ProjectIncidentPolicyDialogProps) {
  const [channels, setChannels] = React.useState<PolicyChannel[]>([]);
  const [channelIds, setChannelIds] = React.useState<Set<string>>(new Set());
  const [emailOwners, setEmailOwners] = React.useState(false);
  const [renotify, setRenotify] = React.useState(false);
  const [minutes, setMinutes] = React.useState("30");
  const [autoInvestigate, setAutoInvestigate] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setLoaded(false);
      setLoadError(false);
      return;
    }
    void getProjectNotificationPolicy(projectId).then((result) => {
      if (!result.success || !result.data) {
        setLoadError(true);
        toast.error(result.error ?? "Failed to load the notification policy");
        return;
      }
      const { policy, channels: available } = result.data;
      setChannels(available);
      // A deleted or disabled channel can linger in the saved policy; keep only those still listed.
      const listed = new Set(available.map((channel) => channel.id));
      setChannelIds(new Set(policy.channelIds.filter((id) => listed.has(id))));
      setEmailOwners(policy.emailServiceOwnersOnSev12);
      setRenotify(policy.renotifyUnackedMinutes !== null);
      setMinutes(String(policy.renotifyUnackedMinutes ?? 30));
      setAutoInvestigate(policy.autoInvestigateOnOpen);
      setLoaded(true);
    });
  }, [open, projectId]);

  const minutesValue = Number(minutes);
  const minutesValid = !renotify || (Number.isInteger(minutesValue) && minutesValue >= 5 && minutesValue <= 1440);

  const save = async () => {
    setSaving(true);
    try {
      const result = await saveProjectNotificationPolicy(projectId, {
        channelIds: [...channelIds],
        emailServiceOwnersOnSev12: emailOwners,
        renotifyUnackedMinutes: renotify ? minutesValue : null,
        autoInvestigateOnOpen: autoInvestigate,
      });
      if (result.success) {
        toast.success("Incident notifications updated");
        onOpenChange(false);
      } else {
        toast.error(result.error ?? "Failed to save");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5" />
            Incident notifications
          </DialogTitle>
          <DialogDescription>
            The Default policy for <span className="font-medium">{projectName}</span>. It covers incidents created by hand or by a connector.
            Monitors and jobs keep the channels chosen on them.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <div className="flex flex-col items-center gap-2 py-8 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm">Failed to load the policy. Close and try again.</p>
          </div>
        ) : !loaded ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label>Channels</Label>
              {channels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This project has no notification channels yet. Without one, an unassigned incident is emailed to the project owners and admins.
                </p>
              ) : (
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {channels.map((channel) => (
                    <label key={channel.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
                      <Checkbox
                        checked={channelIds.has(channel.id)}
                        onCheckedChange={(checked) =>
                          setChannelIds((previous) => {
                            const next = new Set(previous);
                            if (checked) next.add(channel.id);
                            else next.delete(channel.id);
                            return next;
                          })
                        }
                      />
                      <span className="text-sm">{channel.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{channel.type}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="policy-owners" className="font-normal">Email the service owners for SEV1 and SEV2</Label>
              <Switch id="policy-owners" checked={emailOwners} onCheckedChange={setEmailOwners} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="policy-renotify" className="font-normal">Remind once if nobody acknowledges</Label>
                <Switch id="policy-renotify" checked={renotify} onCheckedChange={setRenotify} />
              </div>
              {renotify && (
                <div className="flex items-center gap-2 text-sm">
                  <Label htmlFor="policy-minutes" className="font-normal">After</Label>
                  <Input
                    id="policy-minutes"
                    type="number"
                    min={5}
                    max={1440}
                    value={minutes}
                    onChange={(event) => setMinutes(event.target.value)}
                    className="h-8 w-20"
                    aria-invalid={!minutesValid}
                  />
                  <span className="text-muted-foreground">minutes (5 to 1440)</span>
                </div>
              )}
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="policy-auto" className="font-normal">Investigate new incidents automatically</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  SEV1 and SEV2 get a full AI investigation, SEV3 and SEV4 a quick triage. This uses AI credits.
                </p>
              </div>
              <Switch id="policy-auto" checked={autoInvestigate} onCheckedChange={setAutoInvestigate} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!loaded || saving || !minutesValid}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
