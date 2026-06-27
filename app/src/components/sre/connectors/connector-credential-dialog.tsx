"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  rotateSreConnectorCredential,
  type SreConnectorListItem,
} from "@/actions/sre-connectors";
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

type ConnectorCredentialDialogProps = {
  connector: SreConnectorListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (connector: SreConnectorListItem) => void;
};

type CredentialType = NonNullable<Parameters<typeof rotateSreConnectorCredential>[0]>["credentialType"];

const credentialTypeOptions: Array<{ value: CredentialType; label: string }> = [
  { value: "api_key", label: "API key" },
  { value: "bearer_token", label: "Bearer token" },
  { value: "service_account", label: "Service account" },
  { value: "oauth_token", label: "OAuth token" },
];

export function ConnectorCredentialDialog({
  connector,
  open,
  onOpenChange,
  onSaved,
}: ConnectorCredentialDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [credentialType, setCredentialType] = useState<CredentialType>("api_key");
  const [credentialValue, setCredentialValue] = useState("");
  const [awsAccessKeyId, setAwsAccessKeyId] = useState("");
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState("");
  const [awsSessionToken, setAwsSessionToken] = useState("");
  const isCloudWatch = connector.type === "aws_cloudwatch";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedCredential = credentialValue.trim();
    const trimmedAwsAccessKeyId = awsAccessKeyId.trim();
    const trimmedAwsSecretAccessKey = awsSecretAccessKey.trim();
    const trimmedAwsSessionToken = awsSessionToken.trim();

    if (isCloudWatch && (!trimmedAwsAccessKeyId || !trimmedAwsSecretAccessKey)) {
      toast.error("AWS access key ID and secret access key are required");
      return;
    }

    if (!isCloudWatch && !trimmedCredential) {
      toast.error("Credential value is required");
      return;
    }

    startTransition(async () => {
      const result = await rotateSreConnectorCredential({
        id: connector.id,
        credentialType: isCloudWatch ? "api_key" : credentialType,
        value: isCloudWatch
          ? {
              apiKey: trimmedAwsAccessKeyId,
              secret: trimmedAwsSecretAccessKey,
              ...(trimmedAwsSessionToken ? { sessionToken: trimmedAwsSessionToken } : {}),
            }
          : { secret: trimmedCredential },
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      if (result.connector) {
        onSaved(result.connector);
      }

      setCredentialValue("");
      setAwsAccessKeyId("");
      setAwsSecretAccessKey("");
      setAwsSessionToken("");
      toast.success(result.message);
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl min-w-2xl gap-3 overflow-y-auto p-5">
        <DialogHeader>
          <DialogTitle>Rotate connector credential</DialogTitle>
          <DialogDescription>
            Replace the encrypted credential for {connector.name}. The new secret is never returned after saving.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {isCloudWatch ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rotate-aws-access-key-id">AWS access key ID *</Label>
                <Input
                  id="rotate-aws-access-key-id"
                  value={awsAccessKeyId}
                  onChange={(event) => setAwsAccessKeyId(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  placeholder="AKIA..."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rotate-aws-secret-access-key">AWS secret access key *</Label>
                <Input
                  id="rotate-aws-secret-access-key"
                  value={awsSecretAccessKey}
                  onChange={(event) => setAwsSecretAccessKey(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  placeholder="Paste read-only secret"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="rotate-aws-session-token">AWS session token</Label>
                <Input
                  id="rotate-aws-session-token"
                  value={awsSessionToken}
                  onChange={(event) => setAwsSessionToken(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  placeholder="Optional STS session token"
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rotate-credential-type">Credential type</Label>
                <Select value={credentialType} onValueChange={(value) => setCredentialType(value as CredentialType)}>
                  <SelectTrigger id="rotate-credential-type">
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
                <Label htmlFor="rotate-credential-value">Credential value *</Label>
                <Input
                  id="rotate-credential-value"
                  value={credentialValue}
                  onChange={(event) => setCredentialValue(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  placeholder="Paste read-only credential"
                />
              </div>
            </div>
          )}

          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            Rotation resets validation status. Validate the connector after saving to confirm reachability.
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Rotate credential
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
