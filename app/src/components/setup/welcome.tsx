"use client";

import { useState } from "react";
import { Rocket, Terminal, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { IconChip, type IconTone } from "@/components/ui/icon-chip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useSavePersona } from "@/hooks/use-project-setup";
import { NAV } from "@/lib/nav-areas";
import { PERSONA_OPTIONS, isUserPersona, type UserPersona } from "@/lib/setup/persona";
import { ADMIN_TYPES, TYPE_TONE } from "@/lib/type-tones";

/** Each persona wears the icon and tone of the area it starts in, from the same registries as the sidebar. */
const PERSONA_ICON: Record<UserPersona, { icon: LucideIcon; tone: IconTone }> = {
  sre: { icon: NAV.monitors.icon, tone: NAV.monitors.tone },
  qa: { icon: NAV.tests.icon, tone: NAV.tests.tone },
  developer: { icon: Terminal, tone: TYPE_TONE.admin.cliToken },
  leader: { icon: ADMIN_TYPES.member.icon, tone: TYPE_TONE.admin.member },
};

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
  const [persona, setPersona] = useState<UserPersona | null>(initialPersona ?? null);
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
    <div className="space-y-6" data-testid="setup-welcome">
      <PageHeader
        title={title}
        description={
          mode === "creator" ? (
            <>
              {description}
              <span className="mt-1 block text-xs">This orders the setup steps and the sidebar for you. Nothing is hidden; change it any time from your user menu.</span>
            </>
          ) : (
            description
          )
        }
        icon={NAV.projectSetup.icon}
        tone={NAV.projectSetup.tone}
      />

      <RadioGroup
        aria-label="What will you mostly do here?"
        value={persona ?? ""}
        onValueChange={(value) => isUserPersona(value) && setPersona(value)}
        className="grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {PERSONA_OPTIONS.map((option) => {
          const { icon, tone } = PERSONA_ICON[option.id];
          return (
            <label
              key={option.id}
              htmlFor={`persona-${option.id}`}
              className="flex min-h-[88px] cursor-pointer items-start gap-3 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/70 has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-accent has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring"
            >
              <IconChip icon={icon} tone={tone} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{option.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span>
              </span>
              <RadioGroupItem id={`persona-${option.id}`} value={option.id} className="mt-1" />
            </label>
          );
        })}
      </RadioGroup>

      <div className="flex flex-wrap items-center gap-2 border-t pt-6">
        {mode === "creator" ? (
          <Button disabled={!persona || save.isPending} onClick={() => persona && submit(persona)}>
            <Rocket /> Start setup
          </Button>
        ) : (
          // Members can continue without a pick: no persona keeps today's sidebar, the same as Skip.
          <Button disabled={(mode === "change" && !persona) || save.isPending} onClick={() => submit(persona)}>
            {mode === "change" ? "Save" : "Go to dashboard"}
          </Button>
        )}
        {mode === "change" ? (
          <>
            <Button variant="outline" disabled={save.isPending} onClick={() => submit(null)}>
              No preference
            </Button>
            <Button variant="ghost" disabled={save.isPending} onClick={onDone}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="ghost" disabled={save.isPending} onClick={() => submit(null)}>
            Skip
          </Button>
        )}
      </div>
    </div>
  );
}
