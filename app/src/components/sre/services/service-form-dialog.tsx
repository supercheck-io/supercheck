"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  createSreService,
  updateSreService,
  type SreServiceListItem,
} from "@/actions/sre-services";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type ServiceFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: SreServiceListItem | null;
  onSaved: (service: SreServiceListItem) => void;
};

type FieldErrors = Record<string, string[] | undefined>;

const tierOptions = [
  { value: "1", label: "Tier 1 - customer critical" },
  { value: "2", label: "Tier 2 - business critical" },
  { value: "3", label: "Tier 3 - standard" },
  { value: "4", label: "Tier 4 - internal" },
] as const;

const statusOptions = [
  { value: "active", label: "Active" },
  { value: "deprecated", label: "Deprecated" },
] as const;

function tagsToInput(tags: string[]) {
  return tags.join(", ");
}

function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function firstError(fieldErrors: FieldErrors | undefined, field: string) {
  return fieldErrors?.[field]?.[0] ?? null;
}

export function ServiceFormDialog({
  open,
  onOpenChange,
  service,
  onSaved,
}: ServiceFormDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [tier, setTier] = useState<"1" | "2" | "3" | "4">(service?.tier ?? "3");
  const [environment, setEnvironment] = useState(service?.environment ?? "");
  const [ownerTeam, setOwnerTeam] = useState(service?.ownerTeam ?? "");
  const [repoUrl, setRepoUrl] = useState(service?.repoUrl ?? "");
  const [otelServiceName, setOtelServiceName] = useState(service?.otelServiceName ?? "");
  const [slackChannel, setSlackChannel] = useState(service?.slackChannel ?? "");
  const [status, setStatus] = useState<"active" | "deprecated">(
    service?.status === "deprecated" ? "deprecated" : "active"
  );
  const [tags, setTags] = useState(tagsToInput(service?.tags ?? []));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload = {
      name,
      description,
      tier,
      environment,
      ownerTeam,
      repoUrl,
      otelServiceName,
      slackChannel,
      status,
      tags: parseTags(tags),
    };

    startTransition(async () => {
      const result = service
        ? await updateSreService({ id: service.id, ...payload })
        : await createSreService(payload);

      if (!result.success) {
        setFieldErrors(result.fieldErrors);
        toast.error(result.error);
        return;
      }

      if (result.service) {
        onSaved(result.service);
      }
      toast.success(result.message);
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl min-w-2xl gap-3 overflow-y-auto p-5">
        <DialogHeader>
          <DialogTitle>{service ? "Edit service" : "Add service"}</DialogTitle>
          <DialogDescription>
            Define ownership, runtime identity, and routing metadata for SRE investigations.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="service-name">Service name *</Label>
              <Input
                id="service-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="checkout-api"
                aria-invalid={Boolean(firstError(fieldErrors, "name"))}
              />
              {firstError(fieldErrors, "name") && (
                <p className="text-xs text-destructive">{firstError(fieldErrors, "name")}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="service-tier">Tier</Label>
              <Select value={tier} onValueChange={(value) => setTier(value as typeof tier)}>
                <SelectTrigger id="service-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tierOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="service-status">Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
                <SelectTrigger id="service-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="service-environment">Environment</Label>
              <Input
                id="service-environment"
                value={environment}
                onChange={(event) => setEnvironment(event.target.value)}
                placeholder="production"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="service-owner">Owner team</Label>
              <Input
                id="service-owner"
                value={ownerTeam}
                onChange={(event) => setOwnerTeam(event.target.value)}
                placeholder="payments-platform"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="service-otel">OpenTelemetry service</Label>
              <Input
                id="service-otel"
                value={otelServiceName}
                onChange={(event) => setOtelServiceName(event.target.value)}
                placeholder="checkout-api"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="service-slack">Slack channel</Label>
              <Input
                id="service-slack"
                value={slackChannel}
                onChange={(event) => setSlackChannel(event.target.value)}
                placeholder="#payments-alerts"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="service-repo">Repository URL</Label>
              <Input
                id="service-repo"
                value={repoUrl}
                onChange={(event) => setRepoUrl(event.target.value)}
                placeholder="https://github.com/acme/checkout-api"
                aria-invalid={Boolean(firstError(fieldErrors, "repoUrl"))}
              />
              {firstError(fieldErrors, "repoUrl") && (
                <p className="text-xs text-destructive">{firstError(fieldErrors, "repoUrl")}</p>
              )}
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="service-tags">Tags</Label>
              <Input
                id="service-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="payments, node, postgres"
              />
              <p className="text-xs text-muted-foreground">Separate tags with commas.</p>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="service-description">Description</Label>
              <Textarea
                id="service-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this service owns and what users notice when it fails."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {service ? "Save changes" : "Add service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
