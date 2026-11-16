"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, FlaskConical, Globe, ListChecks, Radar, Tally4, Terminal, UserPlus, type LucideIcon } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconChip, type IconTone } from "@/components/ui/icon-chip";
import { useAppConfig } from "@/hooks/use-app-config";
import { cn } from "@/lib/utils";
import type { SetupFeature } from "@/lib/setup/features";
import { stepOrder, type SetupStepKey, type UserPersona } from "@/lib/setup/persona";
import type { ScanSummary } from "@/lib/setup/scan";
import type { SetupResponse } from "@/lib/setup/types";
import { AlertsStep } from "./steps/alerts-step";
import { AiSreStep } from "./steps/ai-sre-step";
import { AppStep } from "./steps/app-step";
import { DeveloperStep } from "./steps/developer-step";
import { InviteStep } from "./steps/invite-step";
import { MonitorsStep } from "./steps/monitors-step";
import { ReviewStep } from "./steps/review-step";
import { StatusPageStep } from "./steps/status-page-step";
import { TestsStep } from "./steps/tests-step";
import type { StepProps } from "./steps/step-types";
import { useSetupLock, useSetupSession } from "./use-setup-session";

interface StepMeta {
  title: string;
  sub: string;
  icon: LucideIcon;
  tone: IconTone;
}

/** A step exists when it has an entry in both STEP_META and STEP_COMPONENTS; STEP_FLAG hides it when its flag is off. */
const STEP_META: Partial<Record<SetupStepKey, StepMeta>> = {
  developer: { title: "Set up from your terminal", sub: "CLI and coding agents", icon: Terminal, tone: "zinc" },
  invite: { title: "Invite your team first?", sub: "Bring people in", icon: UserPlus, tone: "lime" },
  app: { title: "Your app", sub: "URL and test account", icon: Globe, tone: "monitor" },
  alerts: { title: "Alerts", sub: "Where we tell you", icon: Bell, tone: "communicate" },
  monitors: { title: "Monitors", sub: "Uptime and SSL", icon: Globe, tone: "monitor" },
  statusPage: { title: "Status page", sub: "Tell your users", icon: Tally4, tone: "statuspage" },
  tests: { title: "Requirements and tests", sub: "AI suggestions, Beta", icon: FlaskConical, tone: "automate" },
  aiSre: { title: "AI SRE", sub: "Connect your stack", icon: Radar, tone: "ai" },
  review: { title: "Review and create", sub: "Create everything", icon: ListChecks, tone: "slate" },
};

const STEP_FLAG: Partial<Record<SetupStepKey, SetupFeature>> = {
  tests: "aiTests",
  aiSre: "aiSre",
};

const STEP_COMPONENTS: Partial<Record<SetupStepKey, ComponentType<StepProps>>> = {
  developer: DeveloperStep,
  invite: InviteStep,
  app: AppStep,
  alerts: AlertsStep,
  monitors: MonitorsStep,
  statusPage: StatusPageStep,
  tests: TestsStep,
  aiSre: AiSreStep,
};

function minutesAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
}

interface WizardProps {
  response: SetupResponse;
  persona: UserPersona | null;
  userEmail?: string | null;
}

export function SetupWizard({ response, persona, userEmail }: WizardProps) {
  const router = useRouter();
  const { setupFeatures } = useAppConfig();
  // One token per mounted wizard (per tab), kept in memory only.
  const [lockToken] = useState(() => crypto.randomUUID());
  const session = useSetupSession(response.projectId, response.state, lockToken);
  const lock = useSetupLock(response.projectId, response.permissions.canEdit, response.state.lock, lockToken);
  const [leaving, setLeaving] = useState(false);
  const [scan, setScan] = useState<ScanSummary | null>(response.state.scanResult as ScanSummary | null);
  const [leaveError, setLeaveError] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  // Review reports a running Create here; stop waits for the in-flight item to settle.
  const [creating, setCreating] = useState(false);
  const stopCreate = useRef<(() => Promise<void>) | null>(null);

  const steps = useMemo(
    () =>
      stepOrder(persona, (step) => {
        const flag = STEP_FLAG[step];
        return Boolean(STEP_COMPONENTS[step]) && (flag ? setupFeatures[flag] : true);
      }),
    [persona, setupFeatures],
  );
  const readOnly = !response.permissions.canEdit || lock.readOnly;
  // A lost lock (another tab or person took it) stops a running Create through the same cancel path as leaving.
  useEffect(() => {
    if (lock.readOnly) void stopCreate.current?.();
  }, [lock.readOnly]);
  // A read-only viewer can still look around, but nothing may be written, so the step stays local.
  const [localStep, setLocalStep] = useState<SetupStepKey | null>(null);
  const currentStep = readOnly ? (localStep ?? session.currentStep) : session.currentStep;
  const savedIndex = currentStep ? steps.indexOf(currentStep) : 0;
  const index = Math.max(0, savedIndex);
  const key = steps[index];
  const meta = STEP_META[key] as StepMeta;

  const { status, patch } = session;
  useEffect(() => {
    if (status === "not_started" && !readOnly) patch({ status: "in_progress" });
  }, [status, readOnly, patch]);

  const goTo = (step: SetupStepKey) => (readOnly ? setLocalStep(step) : session.patch({ currentStep: step }));
  const go = (target: number, mode: "back" | "continue" | "skip" = "continue") => {
    if (mode === "back" || readOnly) return goTo(steps[target]);
    const skipped = new Set(session.skipped);
    if (mode === "skip") skipped.add(key);
    else skipped.delete(key);
    session.patch({ currentStep: steps[target], skipped: [...skipped] });
  };

  const stepProps: StepProps = {
    response,
    features: setupFeatures,
    permissions: response.permissions,
    draft: session.draft,
    // A read-only tab never writes, whatever a step calls.
    patchDraft: readOnly ? () => undefined : session.patchDraft,
    setStatusPageOptOut: (optOut) => !readOnly && session.patch({ statusPageOptOut: optOut }),
    readOnly,
    userEmail,
    scan,
    setScan,
  };
  const Body = STEP_COMPONENTS[key];

  const leave = async () => {
    setLeaveError(false);
    // Stop first, so no item or lock claim happens after the lock is released on leaving.
    await stopCreate.current?.();
    // Leaving with an unsaved draft would lose it, so stay and say so.
    if (!(await session.flush())) {
      setLeaveError(true);
      return;
    }
    router.push("/");
  };

  // Same effect as Dismiss on the dashboard card, for owners and admins who land here directly.
  const dismiss = async () => {
    setLeaveError(false);
    setDismissing(true);
    const previous = session.status;
    session.patch({ status: "dismissed" });
    const saved = await session.flush();
    if (!saved) {
      session.patch({ status: previous });
      setLeaveError(true);
      setDismissing(false);
      return;
    }
    router.push("/");
  };

  return (
    <div className="space-y-4" data-testid="setup-wizard">
      {lock.holder?.sameUser ? (
        <Alert variant="warning" data-testid="setup-other-tab">
          <p className="text-sm font-semibold">Setup is open in another tab</p>
          <p className="text-sm">Only one tab can run setup at a time, so nothing is created twice. You can look around here, but nothing can be changed.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={async () => (await lock.useHere()) || toast.error("Could not switch to this tab. Try again.")}
          >
            Use this tab instead
          </Button>
        </Alert>
      ) : lock.holder ? (
        <Alert variant="warning" data-testid="setup-locked">
          <p className="text-sm font-semibold">Setup is already running</p>
          <p className="text-sm">
            {lock.holder.userName ?? "Someone"} started it {minutesAgo(lock.holder.lockedAt)}. Only one person can run setup at a time, so nothing is created twice. You can look around, but nothing here can be changed.
          </p>
          {response.permissions.canUpdateProject ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={async () => (await lock.takeOver()) || toast.error("Could not take over setup. Try again.")}
            >
              Take over
            </Button>
          ) : null}
        </Alert>
      ) : null}
      {!response.permissions.canEdit ? <Alert variant="info">You have view access. A project admin can finish setup.</Alert> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="setup-save-state">
          {session.saveState === "saving" ? "Saving..." : session.saveState === "saved" ? "Draft saved" : session.saveState === "error" ? `Could not save the draft${session.saveError ? `: ${session.saveError}` : ""}` : ""}
          {session.saveState === "error" ? (
            <Button type="button" variant="link" size="sm" onClick={() => void session.flush()}>
              Try again
            </Button>
          ) : null}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => setLeaving(true)}>
          Exit setup
        </Button>
      </div>

      <div className="grid gap-6 min-[900px]:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Setup steps">
          <ol className="flex gap-2 overflow-x-auto pb-1 min-[900px]:flex-col min-[900px]:overflow-visible">
            {steps.map((stepKey, i) => {
              const m = STEP_META[stepKey] as StepMeta;
              const skippedStep = session.skipped.includes(stepKey);
              const done = i < index && !skippedStep;
              const current = i === index;
              return (
                <li key={stepKey} className="shrink-0">
                  <button
                    type="button"
                    data-testid={`setup-step-${stepKey}`}
                    aria-current={current ? "step" : undefined}
                    onClick={() => goTo(stepKey)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      current && "bg-accent font-medium",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
                        done && "border-success bg-success/10 text-success",
                        skippedStep && "border-dashed text-muted-foreground",
                        current && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <span className="min-w-0 whitespace-nowrap min-[900px]:whitespace-normal">
                      {m.title}
                      {skippedStep ? <span className="block text-xs font-normal text-muted-foreground">Skipped</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section aria-labelledby="setup-step-title" className="min-w-0 space-y-6">
          <div className="flex items-start gap-3">
            <IconChip icon={meta.icon} tone={meta.tone} size="md" className="mt-0.5" />
            <div className="min-w-0">
              <h2 id="setup-step-title" className="text-lg font-semibold">
                {meta.title}
              </h2>
              <p className="text-xs text-muted-foreground">
                Step {index + 1} of {steps.length}
              </p>
            </div>
          </div>

          {key === "review" ? (
            <ReviewStep
              {...stepProps}
              skipped={session.skipped}
              waitSeconds={lock.reclaimWaitSeconds}
              recordCreated={session.recordCreated}
              getCreated={session.getCreated}
              heartbeat={lock.heartbeat}
              onActiveChange={setCreating}
              stopRef={stopCreate}
              completed={session.status === "completed"}
              complete={async () => {
                session.patch({ status: "completed" });
                return session.flush();
              }}
            />
          ) : Body ? (
            <Body {...stepProps} />
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <Button type="button" variant="outline" disabled={index === 0} onClick={() => go(index - 1, "back")}>
              Back
            </Button>
            {key !== "review" ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" disabled={readOnly} onClick={() => go(index + 1, "skip")}>
                  Skip this step
                </Button>
                <Button type="button" onClick={() => go(index + 1)}>
                  Continue
                </Button>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <Dialog open={leaving} onOpenChange={setLeaving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave setup?</DialogTitle>
            <DialogDescription>
              {creating
                ? "Items are still being created. Stop and leave cancels the rest after the current item finishes; what was created stays in your project and you can resume from Project setup in the sidebar."
                : Object.keys(session.getCreated()).length > 0
                ? "Items already created stay in your project, and your choices are saved as a draft. You can resume from Project setup in the sidebar."
                : "Your choices are saved as a draft. Nothing has been created yet. You can resume from Project setup in the sidebar."}
            </DialogDescription>
          </DialogHeader>
          {leaveError ? <Alert variant="error">Your draft could not be saved, so setup was not closed. Check your connection and try again.</Alert> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLeaving(false)}>
              Keep going
            </Button>
            {session.saveState === "error" ? (
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  await stopCreate.current?.();
                  router.push("/");
                }}
              >
                Leave without saving
              </Button>
            ) : null}
            {!readOnly ? (
              <Button type="button" variant="ghost" disabled={dismissing || creating} onClick={dismiss}>
                Dismiss setup
              </Button>
            ) : null}
            <Button type="button" disabled={dismissing} onClick={leave}>
              {creating ? "Stop and leave" : "Leave and resume later"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
