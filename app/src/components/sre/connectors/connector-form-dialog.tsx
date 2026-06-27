"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  createSreConnector,
  type SreConnectorListItem,
  type SreConnectorSetupOptions,
} from "@/actions/sre-connectors";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { getConnectorQueryGuide } from "./connector-query-guides";

type ConnectorFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setupOptions: SreConnectorSetupOptions;
  onSaved: (connector: SreConnectorListItem) => void;
};

type ConnectorType = Parameters<typeof createSreConnector>[0]["type"];
type CredentialType = NonNullable<Parameters<typeof createSreConnector>[0]["credential"]>["credentialType"];

const connectorTypeOptions: Array<{ value: ConnectorType; label: string; description: string }> = [
  { value: "github", label: "GitHub", description: "Deploys, commits, pull requests" },
  { value: "kubernetes", label: "Kubernetes", description: "Pods, events, workloads" },
  { value: "prometheus", label: "Prometheus", description: "Metrics and PromQL" },
  { value: "grafana", label: "Grafana", description: "Dashboards and panel context" },
  { value: "datadog", label: "Datadog", description: "Metrics, logs, traces" },
  { value: "aws_cloudwatch", label: "AWS CloudWatch", description: "Metric alarms and CloudWatch metric data" },
  { value: "loki", label: "Loki", description: "LogQL logs" },
  { value: "tempo", label: "Tempo", description: "Distributed traces and TraceQL search" },
  { value: "webhook", label: "Webhook", description: "Inbound operational events" },
];

const privateAgentSupportedConnectorTypes: ConnectorType[] = [
  "github",
  "kubernetes",
  "prometheus",
  "grafana",
  "sentry",
  "datadog",
  "loki",
  "elasticsearch",
  "tempo",
  "aws_cloudwatch",
];

const credentialTypeOptions: Array<{ value: CredentialType; label: string }> = [
  { value: "api_key", label: "API key" },
  { value: "bearer_token", label: "Bearer token" },
  { value: "service_account", label: "Service account" },
  { value: "oauth_token", label: "OAuth token" },
];

type FieldErrors = Record<string, string[] | undefined>;

function firstError(fieldErrors: FieldErrors | undefined, field: string) {
  return fieldErrors?.[field]?.[0] ?? null;
}

export function ConnectorFormDialog({
  open,
  onOpenChange,
  setupOptions,
  onSaved,
}: ConnectorFormDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [name, setName] = useState("");
  const [type, setType] = useState<ConnectorType>("github");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high" | "critical">("low");
  const [executionMode, setExecutionMode] = useState<"direct" | "private_agent">("direct");
  const [privateAgentId, setPrivateAgentId] = useState<string | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [credentialType, setCredentialType] = useState<CredentialType>("api_key");
  const [credentialValue, setCredentialValue] = useState("");
  const [awsAccessKeyId, setAwsAccessKeyId] = useState("");
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState("");
  const [awsSessionToken, setAwsSessionToken] = useState("");
  const isCloudWatch = type === "aws_cloudwatch";
  const supportsPrivateAgent = privateAgentSupportedConnectorTypes.includes(type);
  const queryGuide = getConnectorQueryGuide(type);

  const toggleService = (serviceId: string) => {
    setSelectedServiceIds((current) =>
      current.includes(serviceId)
        ? current.filter((id) => id !== serviceId)
        : [...current, serviceId]
    );
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedCredential = credentialValue.trim();
    const trimmedAwsAccessKeyId = awsAccessKeyId.trim();
    const trimmedAwsSecretAccessKey = awsSecretAccessKey.trim();
    const trimmedAwsSessionToken = awsSessionToken.trim();

    startTransition(async () => {
      const result = await createSreConnector({
        name,
        type,
        endpointUrl,
        riskLevel,
        privateAgentId: executionMode === "private_agent" ? privateAgentId : null,
        serviceIds: selectedServiceIds,
        defaultTimeWindowMinutes: 60,
        outputLimits: { maxRows: 100, maxBytes: 1_048_576, maxSeconds: 10 },
        credential: isCloudWatch && trimmedAwsAccessKeyId && trimmedAwsSecretAccessKey
          ? {
              credentialType: "api_key",
              value: {
                apiKey: trimmedAwsAccessKeyId,
                secret: trimmedAwsSecretAccessKey,
                ...(trimmedAwsSessionToken ? { sessionToken: trimmedAwsSessionToken } : {}),
              },
            }
          : trimmedCredential
          ? {
              credentialType,
              value: { secret: trimmedCredential },
            }
          : undefined,
      });

      if (!result.success) {
        setFieldErrors(result.fieldErrors);
        toast.error(result.error);
        return;
      }

      if (result.connector) {
        onSaved(result.connector);
      }

      toast.success(result.message);
      setCredentialValue("");
      setAwsAccessKeyId("");
      setAwsSecretAccessKey("");
      setAwsSessionToken("");
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl min-w-2xl gap-3 overflow-y-auto p-5">
        <DialogHeader>
          <DialogTitle>Add connector</DialogTitle>
          <DialogDescription>
            Configure a read-only SRE connector. Secrets are encrypted server-side and never shown to the AI model.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="connector-type">Connector type</Label>
              <Select
                value={type}
                onValueChange={(value) => {
                  const nextType = value as ConnectorType;
                  setType(nextType);
                  if (!privateAgentSupportedConnectorTypes.includes(nextType)) {
                    setExecutionMode("direct");
                    setPrivateAgentId(null);
                  }
                }}
              >
                <SelectTrigger id="connector-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {connectorTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {connectorTypeOptions.find((option) => option.value === type)?.description}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="connector-name">Name *</Label>
              <Input
                id="connector-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Production GitHub"
                aria-invalid={Boolean(firstError(fieldErrors, "name"))}
              />
              {firstError(fieldErrors, "name") && (
                <p className="text-xs text-destructive">{firstError(fieldErrors, "name")}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="connector-risk">Risk level</Label>
              <Select value={riskLevel} onValueChange={(value) => setRiskLevel(value as typeof riskLevel)}>
                <SelectTrigger id="connector-risk">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="connector-execution">Execution mode</Label>
              <Select value={executionMode} onValueChange={(value) => setExecutionMode(value as typeof executionMode)}>
                <SelectTrigger id="connector-execution">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct">Direct</SelectItem>
                  <SelectItem value="private_agent" disabled={setupOptions.privateAgents.length === 0 || !supportsPrivateAgent}>
                    Private Agent
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="connector-endpoint">Endpoint URL</Label>
              <Input
                id="connector-endpoint"
                value={endpointUrl}
                onChange={(event) => setEndpointUrl(event.target.value)}
                placeholder={queryGuide.endpointPlaceholder}
                aria-invalid={Boolean(firstError(fieldErrors, "endpointUrl"))}
              />
              {firstError(fieldErrors, "endpointUrl") ? (
                <p className="text-xs text-destructive">{firstError(fieldErrors, "endpointUrl")}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Required for direct Prometheus, Grafana, Kubernetes, CloudWatch, Tempo, and custom HTTP-style connectors. Private Agent supports the implemented read-only SRE connectors for private-network access.
                </p>
              )}
            </div>

            <div className="space-y-3 rounded-lg border bg-background p-3 md:col-span-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-medium">{queryGuide.label} query guide</p>
                  <p className="text-xs text-muted-foreground">{queryGuide.setupHint}</p>
                </div>
                <Badge variant="outline">{queryGuide.queryLabel}</Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {queryGuide.examples.map((example) => (
                  <div key={example.label} className="rounded-md border bg-muted/20 p-2">
                    <p className="text-xs font-medium">{example.label}</p>
                    <code className="mt-1 block break-words rounded bg-muted px-2 py-1 font-mono text-xs">
                      {example.query}
                    </code>
                    <p className="mt-1 text-xs text-muted-foreground">{example.description}</p>
                  </div>
                ))}
              </div>
              {queryGuide.docs && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {queryGuide.docs.map((doc) => (
                    <a
                      key={doc.href}
                      href={doc.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {doc.label}
                    </a>
                  ))}
                </div>
              )}
            </div>

            {executionMode === "private_agent" && (
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="private-agent">Private Agent</Label>
                <Select value={privateAgentId ?? undefined} onValueChange={setPrivateAgentId}>
                  <SelectTrigger id="private-agent">
                    <SelectValue placeholder="Select an agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {setupOptions.privateAgents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name} ({agent.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2 md:col-span-2">
              <div>
                <Label>Service scope</Label>
                <p className="text-xs text-muted-foreground">
                  Limit where this connector can be used. Leave empty only for org-wide read-only sources.
                </p>
              </div>
              {setupOptions.services.length === 0 ? (
                <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  No active services are available. Add services before scoping connectors.
                </div>
              ) : (
                <div className="grid max-h-32 gap-1 overflow-y-auto rounded-lg border p-2 md:grid-cols-2">
                  {setupOptions.services.map((service) => (
                    <label
                      key={service.id}
                      className="flex cursor-pointer items-start gap-2 rounded-md p-2 hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={selectedServiceIds.includes(service.id)}
                        onCheckedChange={() => toggleService(service.id)}
                        aria-label={`Scope connector to ${service.name}`}
                      />
                      <span className="space-y-1 text-sm">
                        <span className="block font-medium">{service.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {[service.environment, service.ownerTeam].filter(Boolean).join(" · ") || "No metadata"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {isCloudWatch ? (
              <div className="grid gap-4 md:col-span-2 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="aws-access-key-id">AWS access key ID</Label>
                  <Input
                    id="aws-access-key-id"
                    value={awsAccessKeyId}
                    onChange={(event) => setAwsAccessKeyId(event.target.value)}
                    type="password"
                    autoComplete="new-password"
                    placeholder="AKIA..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aws-secret-access-key">AWS secret access key</Label>
                  <Input
                    id="aws-secret-access-key"
                    value={awsSecretAccessKey}
                    onChange={(event) => setAwsSecretAccessKey(event.target.value)}
                    type="password"
                    autoComplete="new-password"
                    placeholder="Paste read-only secret"
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="aws-session-token">AWS session token</Label>
                  <Input
                    id="aws-session-token"
                    value={awsSessionToken}
                    onChange={(event) => setAwsSessionToken(event.target.value)}
                    type="password"
                    autoComplete="new-password"
                    placeholder="Optional STS session token"
                  />
                  <p className="text-xs text-muted-foreground">
                    {queryGuide.credentialHint} Credentials are encrypted server-side, scoped to the selected Private Agent when used, and redacted before AI context.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="credential-type">Credential type</Label>
                  <Select value={credentialType} onValueChange={(value) => setCredentialType(value as CredentialType)}>
                    <SelectTrigger id="credential-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {credentialTypeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="credential-value">Credential value</Label>
                  <Input
                    id="credential-value"
                    value={credentialValue}
                    onChange={(event) => setCredentialValue(event.target.value)}
                    type="password"
                    autoComplete="new-password"
                    placeholder="Paste read-only credential"
                  />
                  <p className="text-xs text-muted-foreground">{queryGuide.credentialHint}</p>
                </div>
              </>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
            <p>Connector calls are budgeted, scoped to services, redacted, and audited before agent use.</p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Badge variant="outline">Read-only</Badge>
              <Badge variant="outline">No side effects</Badge>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add connector
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
