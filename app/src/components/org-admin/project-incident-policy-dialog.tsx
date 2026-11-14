"use client";

import * as React from "react";
import { AlertCircle, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  getProjectNotificationPolicy,
  saveProjectNotificationPolicy,
  type PolicyChannel,
  type PolicyMember,
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const MAX_POLICY_CHANNELS = 10;
/** Reminders stop after 2 days (the server's limit), so the whole schedule must fit. */
const MAX_SCHEDULE_MINUTES = 2880;
const PAGING_HINT = "Paged by monitor and job alerts";

const inRange = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

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
  const [repeat, setRepeat] = React.useState(false);
  const [repeatMinutes, setRepeatMinutes] = React.useState("60");
  const [maxReminders, setMaxReminders] = React.useState("3");
  const [escalate, setEscalate] = React.useState(false);
  const [escalateMinutes, setEscalateMinutes] = React.useState("30");
  const [escalateTarget, setEscalateTarget] = React.useState("");
  const [targetRemoved, setTargetRemoved] = React.useState(false);
  const [staleTarget, setStaleTarget] = React.useState("");
  const [members, setMembers] = React.useState<PolicyMember[]>([]);
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
    void getProjectNotificationPolicy(projectId)
      .catch(() => null)
      .then((result) => {
      if (!result?.success || !result.data) {
        setLoadError(true);
        toast.error(result?.error ?? "Failed to load the notification policy");
        return;
      }
      const { policy, channels: available, members: people } = result.data;
      setChannels(available);
      setMembers(people ?? []);
      // A deleted or disabled channel can linger in the saved policy; keep only those still listed.
      const listed = new Set(available.map((channel) => channel.id));
      setChannelIds(new Set(policy.channelIds.filter((id) => listed.has(id))));
      setEmailOwners(policy.emailServiceOwnersOnSev12);
      setRenotify(policy.renotifyUnackedMinutes !== null);
      setMinutes(String(policy.renotifyUnackedMinutes ?? 30));
      setRepeat(policy.renotifyRepeatMinutes != null);
      setRepeatMinutes(String(policy.renotifyRepeatMinutes ?? 60));
      setMaxReminders(String(policy.renotifyMax ?? 3));
      setEscalate(policy.escalateAfterMinutes != null);
      setEscalateMinutes(String(policy.escalateAfterMinutes ?? 30));
      const storedTarget = policy.escalateChannelId ? `channel:${policy.escalateChannelId}` : policy.escalateUserId ? `member:${policy.escalateUserId}` : "";
      // A deleted target clears the id (on delete set null); a disabled channel, a paging channel or a member who
      // lost access stays stored but is no longer listed. Either way, say so instead of silently not escalating.
      // An unusable stored target is kept as is, so saving other settings still works.
      const usable =
        (policy.escalateChannelId && available.some((channel) => channel.id === policy.escalateChannelId && !channel.paging)) ||
        (policy.escalateUserId && (people ?? []).some((person) => person.id === policy.escalateUserId));
      setEscalateTarget(storedTarget);
      setStaleTarget(storedTarget !== "" && !usable ? storedTarget : "");
      setTargetRemoved(policy.escalateAfterMinutes != null && !usable);
      setAutoInvestigate(policy.autoInvestigateOnOpen);
      setLoaded(true);
    });
  }, [open, projectId]);

  const minutesValue = Number(minutes);
  const minutesValid = !renotify || inRange(minutesValue, 5, 1440);
  const repeatValue = Number(repeatMinutes);
  const maxValue = Number(maxReminders);
  const repeatOn = renotify && repeat;
  // Repeating needs at least two reminders; "at most 1" would remind once.
  const repeatValid = !repeatOn || (inRange(repeatValue, 5, 1440) && inRange(maxValue, 2, 10));
  const scheduleValid = !repeatOn || !repeatValid || minutesValue + (maxValue - 1) * repeatValue <= MAX_SCHEDULE_MINUTES;
  const escalateValue = Number(escalateMinutes);
  // A removed target can stay while the escalation is unchanged (the server re-checks), so other settings can be saved.
  const escalateValid = !escalate || (inRange(escalateValue, 5, 1440) && (escalateTarget !== "" || targetRemoved));
  const formValid = minutesValid && repeatValid && scheduleValid && escalateValid;

  const save = async () => {
    setSaving(true);
    try {
      const result = await saveProjectNotificationPolicy(projectId, {
        channelIds: [...channelIds],
        emailServiceOwnersOnSev12: emailOwners,
        renotifyUnackedMinutes: renotify ? minutesValue : null,
        renotifyRepeatMinutes: repeatOn ? repeatValue : null,
        // Kept as chosen even while repeat is off, so turning repeat on later keeps a sensible count.
        renotifyMax: inRange(maxValue, 2, 10) ? maxValue : 3,
        escalateAfterMinutes: escalate ? escalateValue : null,
        escalateChannelId: escalate && escalateTarget.startsWith("channel:") ? escalateTarget.slice("channel:".length) : null,
        escalateUserId: escalate && escalateTarget.startsWith("member:") ? escalateTarget.slice("member:".length) : null,
        autoInvestigateOnOpen: autoInvestigate,
      }).catch(() => null);
      if (result?.success) {
        toast.success("Incident notifications updated");
        onOpenChange(false);
      } else {
        toast.error(result?.error ?? "Failed to save");
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
                        // The server accepts at most MAX_POLICY_CHANNELS; paging services never get incident messages
                        // (a saved one stays uncheckable).
                        disabled={!channelIds.has(channel.id) && (channelIds.size >= MAX_POLICY_CHANNELS || channel.paging)}
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
                      <span className="ml-auto text-xs text-muted-foreground">{channel.paging ? PAGING_HINT : channel.type}</span>
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
                <Label htmlFor="policy-renotify" className="font-normal">Remind if nobody acknowledges</Label>
                <Switch id="policy-renotify" checked={renotify} onCheckedChange={setRenotify} />
              </div>
              {renotify && (
                <div className="space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor="policy-minutes" className="font-normal">First after</Label>
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
                    <span className="text-muted-foreground">minutes</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Switch id="policy-repeat" checked={repeat} onCheckedChange={setRepeat} aria-label="Repeat the reminder" />
                    <Label htmlFor="policy-repeat-minutes" className="font-normal">Then every</Label>
                    {repeat ? (
                      <>
                        <Input
                      id="policy-repeat-minutes"
                      type="number"
                      min={5}
                      max={1440}
                      value={repeatMinutes}
                      onChange={(event) => setRepeatMinutes(event.target.value)}
                      className="h-8 w-20"
                      aria-invalid={!repeatValid}
                    />
                        <span className="text-muted-foreground">minutes,</span>
                        <Label htmlFor="policy-max" className="font-normal">at most</Label>
                        <Input
                      id="policy-max"
                      type="number"
                      min={2}
                      max={10}
                      value={maxReminders}
                      onChange={(event) => setMaxReminders(event.target.value)}
                      className="h-8 w-20"
                      aria-invalid={!repeatValid}
                    />
                        <span className="text-muted-foreground">reminders</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">off (remind once)</span>
                    )}
                  </div>
                  {repeatOn && !repeatValid && (
                    <p role="alert" className="text-xs text-destructive">Repeat every 5 to 1,440 minutes, at most 2 to 10 reminders.</p>
                  )}
                  {!scheduleValid && (
                    <p role="alert" className="text-xs text-destructive">Reminders must finish within 2 days. Use fewer reminders or a shorter interval.</p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="policy-escalate" className="font-normal">Escalate if still unacknowledged</Label>
                <Switch id="policy-escalate" checked={escalate} onCheckedChange={setEscalate} />
              </div>
              {escalate && (
                <div className="space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor="policy-escalate-minutes" className="font-normal">After</Label>
                    <Input
                      id="policy-escalate-minutes"
                      type="number"
                      min={5}
                      max={1440}
                      value={escalateMinutes}
                      onChange={(event) => setEscalateMinutes(event.target.value)}
                      className="h-8 w-20"
                      aria-invalid={!inRange(escalateValue, 5, 1440)}
                    />
                    <span className="text-muted-foreground">minutes, to</span>
                  </div>
                  <Select value={escalateTarget} onValueChange={(value) => { setEscalateTarget(value); setTargetRemoved(false); }}>
                    <SelectTrigger aria-label="Escalation target" data-testid="policy-escalate-target" aria-invalid={escalateTarget === ""}>
                      <SelectValue placeholder="Choose a channel or a member" />
                    </SelectTrigger>
                    <SelectContent>
                      {staleTarget && (
                        <SelectItem value={staleTarget} disabled>
                          {staleTarget.startsWith("channel:") ? "Removed or disabled channel" : "Member without access"}
                        </SelectItem>
                      )}
                      <SelectGroup>
                        <SelectLabel>Channels</SelectLabel>
                        {channels.length === 0 && <SelectItem value="none-channels" disabled>No channels</SelectItem>}
                        {channels.map((channel) => (
                          <SelectItem key={channel.id} value={`channel:${channel.id}`} disabled={channel.paging}>
                            {channel.name}{channel.paging ? ` (${PAGING_HINT})` : ""}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>Members (by email)</SelectLabel>
                        {members.length === 0 && <SelectItem value="none-members" disabled>No members can act on incidents</SelectItem>}
                        {members.map((person) => (
                          <SelectItem key={person.id} value={`member:${person.id}`}>{person.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {targetRemoved && (
                    <p role="alert" className="text-xs text-destructive">
                      Escalation target was removed. Nothing is escalated until you choose a new one or turn escalation off.
                    </p>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Reminders stop when someone acknowledges, resolves or lowers the severity.</p>
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
          <Button onClick={save} disabled={!loaded || saving || !formValid}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
