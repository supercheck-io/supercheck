"use client";

import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { stripUrl } from "@/lib/setup/draft-schema";
import { ScanPanel } from "./scan-panel";
import { checkSetupProject, postJson, responseError, type StepProps } from "./step-types";

/** Secret names are 4-20 chars, uppercase (createVariableSchema). */
const TEST_ACCOUNT_USER = "SETUP_TEST_USER";
const TEST_ACCOUNT_PASSWORD = "SETUP_TEST_PASS";

export function AppStep({ response, draft, patchDraft, readOnly, scan, setScan }: StepProps) {
  const [url, setUrl] = useState(draft.app?.url ?? "");
  const [touched, setTouched] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  // Secrets this attempt already created (key -> value), so a retry after a partial failure continues with the rest.
  const created = useRef(new Map<string, string>());

  const stripped = url.trim() ? stripUrl(url) : null;
  const invalid = touched && url.trim() !== "" && !stripped;

  const commitUrl = (value: string) => {
    setUrl(value);
    const next = value.trim() ? stripUrl(value) : undefined;
    if (value.trim() === "" || next) patchDraft((d) => ({ ...d, app: { ...d.app, url: next ?? undefined } }));
  };

  // Saved immediately as project secrets (D8); the draft keeps only the name of the password secret.
  const saveAccount = async () => {
    setSaving(true);
    setAccountError(null);
    try {
      // The variables route also refuses a switched project (expected-project header); this covers the rest.
      const changed = await checkSetupProject(response.projectId);
      if (changed) {
        setAccountError(changed);
        return;
      }
      const pairs: Array<[string, string, string]> = [
        [TEST_ACCOUNT_USER, username, "Setup test account username"],
        [TEST_ACCOUNT_PASSWORD, password, "Setup test account password"],
      ];
      for (const [key, value, description] of pairs) {
        if (created.current.get(key) === value) continue;
        const res = await postJson("/api/variables", { key, value, isSecret: true, description }, response.projectId);
        if (!res.ok) {
          setAccountError(res.status === 409 && !created.current.has(key) ? "A secret with this name already exists. Update it in Variables." : responseError(res.data, "Could not save the test account"));
          return;
        }
        created.current.set(key, value);
      }
      patchDraft((d) => ({ ...d, app: { ...d.app, testAccountSecret: TEST_ACCOUNT_PASSWORD } }));
      setUsername("");
      setPassword("");
    } catch {
      setAccountError("Could not save the test account. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const savedSecret = draft.app?.testAccountSecret;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="setup-app-url">App URL</Label>
        <Input
          id="setup-app-url"
          type="url"
          inputMode="url"
          placeholder="https://app.example.com"
          value={url}
          disabled={readOnly}
          aria-invalid={invalid}
          aria-describedby="setup-app-url-help"
          onChange={(event) => commitUrl(event.target.value)}
          onBlur={() => setTouched(true)}
        />
        <p id="setup-app-url-help" className={invalid ? "text-xs text-failure" : "text-xs text-muted-foreground"}>
          {invalid ? "Enter a full http or https address." : "The next steps suggest monitors for this address. Query strings are not stored."}
        </p>
      </div>

      <ScanPanel projectId={response.projectId} url={stripped} disabled={readOnly || invalid} onResult={setScan} initial={scan} />

      <fieldset className="space-y-3 rounded-lg border p-4" disabled={readOnly}>
        <legend className="px-1 text-sm font-semibold">
          Test account <span className="font-normal text-muted-foreground">(optional)</span>
        </legend>
        {savedSecret ? (
          <Alert variant="success">
            Saved as the project secrets <code className="font-mono text-xs">{TEST_ACCOUNT_USER}</code> and{" "}
            <code className="font-mono text-xs">{savedSecret}</code>. Manage them in Variables.
          </Alert>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Use a dedicated test account, not a real customer or admin. It is saved encrypted as a project secret right away, never in the setup draft.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="setup-test-user">Username</Label>
                <Input id="setup-test-user" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setup-test-pass">Password</Label>
                <Input id="setup-test-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
            {accountError ? <Alert variant="error">{accountError}</Alert> : null}
            <Button type="button" variant="outline" size="sm" disabled={!username || !password || saving} onClick={saveAccount}>
              Save test account
            </Button>
          </>
        )}
      </fieldset>
    </div>
  );
}
