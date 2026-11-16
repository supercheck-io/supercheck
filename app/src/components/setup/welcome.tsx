"use client";

import { useState } from "react";
import { Rocket } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useSavePersona } from "@/hooks/use-project-setup";
import { NAV } from "@/lib/nav-areas";
import { PERSONA_OPTIONS, isUserPersona, type UserPersona } from "@/lib/setup/persona";

interface WelcomeProps {
  /** creator: Start setup / Skip. member: persona only, Go to dashboard / Skip. */
  mode: "creator" | "member" | "change";
  /** change: the persona already saved, preselected. */
  initialPersona?: UserPersona | null;
  projectName: string;
  organizationName?: string | null;
  /** Called after the persona (or its skip) is saved. */
  onDone: () => void;
}

/** The one persona question (D13). Saving also marks it as seen, so it is shown once per user. */
export function Welcome({ mode, projectName, organizationName, initialPersona = null, onDone }: WelcomeProps) {
  const [persona, setPersona] = useState<UserPersona | null>(initialPersona);
  const save = useSavePersona();

  const submit = (value: UserPersona | null) =>
    save.mutate(value, {
      onSuccess: onDone,
      onError: () => toast.error("Could not save your choice. Try again."),
    });

  const title =
    mode === "creator"
      ? "Welcome to Supercheck"
      : mode === "change"
        ? "Change your persona"
        : `You joined ${organizationName || "the organization"}. What will you mostly do here?`;
  const description =
    mode === "creator"
      ? `Let's set up ${projectName}. What will you mostly do here?`
      : mode === "change"
        ? "This orders the sidebar and the setup steps for you. Nothing is hidden."
        : "This orders the sidebar for you. Nothing is hidden; change it any time from your user menu.";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6" data-testid="setup-welcome">
      <div className="flex items-start gap-3">
        <IconChip icon={NAV.projectSetup.icon} tone={NAV.projectSetup.tone} size="md" className="mt-0.5" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
          {mode === "creator" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              This orders the setup steps and the sidebar for you. Nothing is hidden; change it any time from your user menu.
            </p>
          ) : null}
        </div>
      </div>

      <RadioGroup
        aria-label="What will you mostly do here?"
        value={persona ?? ""}
        onValueChange={(value) => isUserPersona(value) && setPersona(value)}
        className="grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {PERSONA_OPTIONS.map((option) => (
          <label
            key={option.id}
            htmlFor={`persona-${option.id}`}
            className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-accent has-[button[data-state=checked]]:border-primary has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring"
          >
            <RadioGroupItem id={`persona-${option.id}`} value={option.id} className="mt-1" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{option.title}</span>
              <span className="block text-xs text-muted-foreground">{option.description}</span>
            </span>
          </label>
        ))}
      </RadioGroup>

      <div className="flex flex-wrap items-center gap-2">
        {mode === "creator" ? (
          <Button disabled={!persona || save.isPending} onClick={() => persona && submit(persona)}>
            <Rocket /> Start setup
          </Button>
        ) : (
          <Button disabled={!persona || save.isPending} onClick={() => persona && submit(persona)}>
            {mode === "change" ? "Save" : "Go to dashboard"}
          </Button>
        )}
        {mode === "change" ? (
          <Button variant="ghost" disabled={save.isPending} onClick={onDone}>
            Cancel
          </Button>
        ) : (
          <Button variant="ghost" disabled={save.isPending} onClick={() => submit(null)}>
            Skip
          </Button>
        )}
      </div>
    </div>
  );
}
