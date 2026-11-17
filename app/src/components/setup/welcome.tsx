"use client";

import { useState } from "react";
import { LayoutGrid, Rocket, Terminal, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { IconChip, type IconTone } from "@/components/ui/icon-chip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useSavePersona } from "@/hooks/use-project-setup";
import { NAV } from "@/lib/nav-areas";
import { PERSONA_OPTIONS, SETUP_STEP_SHORT_LABEL, isUserPersona, sidebarLayout, stepOrder, type UserPersona } from "@/lib/setup/persona";
import { ADMIN_TYPES, TYPE_TONE } from "@/lib/type-tones";

/** Each persona wears the icon and tone of the area it starts in, from the same registries as the sidebar. */
const PERSONA_ICON: Record<UserPersona, { icon: LucideIcon; tone: IconTone }> = {
  sre: { icon: NAV.monitors.icon, tone: NAV.monitors.tone },
  qa: { icon: NAV.tests.icon, tone: NAV.tests.tone },
  developer: { icon: Terminal, tone: TYPE_TONE.admin.cliToken },
  leader: { icon: ADMIN_TYPES.member.icon, tone: TYPE_TONE.admin.member },
};

/** "default" is the no-persona choice, shown as a card instead of a separate button. */
type Choice = UserPersona | "default";
const OPTIONS: Array<{ id: Choice; title: string; description: string; icon: LucideIcon; tone: IconTone }> = [
  ...PERSONA_OPTIONS.map((o) => ({ ...o, ...PERSONA_ICON[o.id] })),
  { id: "default", title: "Show everything", description: "The standard layout, every group open. Pick this if you do a bit of everything.", icon: LayoutGrid, tone: "slate" },
];
const toPersona = (choice: Choice | null): UserPersona | null => (choice && choice !== "default" ? choice : null);

/** What a choice changes: the sidebar order (with the group that opens) and the first setup steps. */
function ChoicePreview({ choice }: { choice: Choice }) {
  const persona = toPersona(choice);
  const layout = sidebarLayout(persona);
  const steps = stepOrder(persona).slice(0, 3);
  return (
    <span className="mt-3 block space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
      <span className="flex flex-wrap items-center gap-1">
        <span className="w-20 shrink-0">Sidebar</span>
        {layout.order.map((group) => (
          <span
            key={group}
            className={
              layout.expanded === group
                ? "rounded bg-primary/10 px-1.5 py-0.5 font-medium text-foreground"
                : "rounded bg-muted px-1.5 py-0.5"
            }
          >
            {group}
          </span>
        ))}
      </span>
      <span className="flex flex-wrap items-center gap-1">
        <span className="w-20 shrink-0">Setup starts</span>
        <span className="text-foreground">{steps.map((s) => SETUP_STEP_SHORT_LABEL[s]).join(" → ")}</span>
      </span>
    </span>
  );
}

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
  // Change mode always has a current choice: the saved persona, or "Show everything" when there is none.
  const [choice, setChoice] = useState<Choice | null>(mode === "change" ? initialPersona ?? "default" : null);
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
        ? "This orders the sidebar and the setup steps for you. Nothing is hidden, and you can change it any time from your user menu."
        : "This orders the sidebar for you. Nothing is hidden; change it any time from your user menu.";

  return (
    <div className="space-y-6" data-testid="setup-welcome">
      <PageHeader
        title={title}
        description={
          mode === "creator" ? (
            <>
              {description}
              <span className="mt-1 block text-xs">Your pick orders the setup steps and the sidebar. Nothing is hidden; change it any time from your user menu.</span>
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
        value={choice ?? ""}
        onValueChange={(value) => (value === "default" || isUserPersona(value)) && setChoice(value)}
        className="grid-cols-1 gap-3 md:grid-cols-2"
      >
        {OPTIONS.map((option) => (
          <label
            key={option.id}
            htmlFor={`persona-${option.id}`}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/70 has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-accent has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring ${option.id === "default" ? "md:col-span-2" : ""}`}
          >
            <IconChip icon={option.icon} tone={option.tone} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{option.title}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
              <ChoicePreview choice={option.id} />
            </span>
            <RadioGroupItem id={`persona-${option.id}`} value={option.id} className="mt-1" />
          </label>
        ))}
      </RadioGroup>

      <div className="flex flex-wrap items-center gap-2 border-t pt-6">
        {mode === "creator" ? (
          <Button disabled={!choice || save.isPending} onClick={() => choice && submit(toPersona(choice))}>
            <Rocket /> Start setup
          </Button>
        ) : (
          // Members can continue without a pick: no persona keeps today's sidebar, the same as Skip.
          <Button disabled={save.isPending} onClick={() => submit(toPersona(choice))}>
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
