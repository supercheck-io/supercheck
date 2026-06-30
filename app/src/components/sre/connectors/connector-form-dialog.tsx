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
  { value: "jira", label: "Jira", description: "Tickets, incident records, change context" },
  { value: "confluence", label: "Confluence", description: "Runbooks, postmortems, operational docs" },
  { value: "notion", label: "Notion", description: "Knowledge base, runbooks, incident notes" },
  { value: "slack", label: "Slack", description: "Incident channels and responder discussion" },
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
      <DialogContent className="w-[min(96vw,88rem)] max-w-none min-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>Add connector</DialogTitle>
          <DialogDescription>
            Add a read-only evidence source for investigations. Secrets stay encrypted and are never shown to the AI model.
          </DialogDescription>
        </DialogHeader>

        <form className="flex min-h-0 flex-col" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-5 px-6 py-5">
            <section className="grid gap-4 xl:grid-cols-12">
              <div className="flex flex-col gap-1.5 xl:col-span-3">
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

              <div className="flex flex-col gap-1.5 xl:col-span-4">
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

              <div className="flex flex-col gap-1.5 xl:col-span-2">
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

              <div className="flex flex-col gap-1.5 xl:col-span-3">
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

              {executionMode === "private_agent" && (
                <div className="flex flex-col gap-1.5 xl:col-span-4">
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

              <div className="flex flex-col gap-1.5 xl:col-span-5">
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
                    Use the read-only API endpoint reachable from the selected execution mode.
                  </p>
                )}
              </div>

              {isCloudWatch ? (
                <>
                  <div className="flex flex-col gap-1.5 xl:col-span-3">
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
                  <div className="flex flex-col gap-1.5 xl:col-span-4">
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
                  <div className="flex flex-col gap-1.5 xl:col-span-5">
                    <Label htmlFor="aws-session-token">AWS session token</Label>
                    <Input
                      id="aws-session-token"
                      value={awsSessionToken}
                      onChange={(event) => setAwsSessionToken(event.target.value)}
                      type="password"
                      autoComplete="new-password"
                      placeholder="Optional STS token"
                    />
                    <p className="text-xs text-muted-foreground">{queryGuide.credentialHint}</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5 xl:col-span-3">
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

                  <div className="flex flex-col gap-1.5 xl:col-span-4">
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
            </section>

            <section className="rounded-lg border p-4">
              <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
                <div className="flex flex-col gap-1">
                  <Label>Service scope</Label>
                  <p className="text-xs text-muted-foreground">Optional. Leave empty for org-wide read-only use.</p>
                </div>
                {setupOptions.services.length === 0 ? (
                  <div className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                    No active services are available. Add services before scoping connectors.
                  </div>
                ) : (
                  <div className="grid gap-1 rounded-lg border bg-background/70 p-2 md:grid-cols-2 xl:grid-cols-3">
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
                        <span className="flex min-w-0 flex-col gap-0.5 text-sm">
                          <span className="truncate font-medium">{service.name}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {[service.environment, service.ownerTeam].filter(Boolean).join(" · ") || "No metadata"}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Read-only, budgeted, service-scoped, redacted, and audited.</span>
              <Badge variant="outline">No side effects</Badge>
            </div>
          </div>

          <DialogFooter className="border-t px-6 py-4">
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
