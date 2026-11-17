"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, LayoutGrid, Rocket, Terminal, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { IconChip, type IconTone } from "@/components/ui/icon-chip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { USER_PREFERENCES_QUERY_KEY, useSavePersona } from "@/hooks/use-project-setup";
import type { UserPreferencesDto } from "@/lib/setup/types";
import { NAV } from "@/lib/nav-areas";
import { PERSONA_OPTIONS, SETUP_STEP_SHORT_LABEL, isUserPersona, sidebarLayout, stepOrder, type UserPersona } from "@/lib/setup/persona";
import { ADMIN_TYPES, TYPE_TONE } from "@/lib/type-tones";

/** Each persona's icon is the area it starts in (same icons as the sidebar); this page shows them all in one neutral tone. */
const PERSONA_ICON: Record<UserPersona, LucideIcon> = {
  sre: NAV.monitors.icon,
  qa: NAV.tests.icon,
  developer: Terminal,
  leader: ADMIN_TYPES.member.icon,
};

const NEUTRAL_TONE: IconTone = TYPE_TONE.admin.cliToken;

/** "default" is the no-persona choice, shown as a card instead of a separate button. */
type Choice = UserPersona | "default";
const OPTIONS: Array<{ id: Choice; title: string; description: string; icon: LucideIcon; tone: IconTone }> = [
  // One neutral tone (the CLI card's) on this page: the cards are choices, not product areas.
  ...PERSONA_OPTIONS.map((o) => ({ ...o, icon: PERSONA_ICON[o.id], tone: NEUTRAL_TONE })),
  { id: "default", title: "A bit of everything", description: "The standard layout: every sidebar group open and setup in the usual order.", icon: LayoutGrid, tone: NEUTRAL_TONE },
];
const toPersona = (choice: Choice | null): UserPersona | null => (choice && choice !== "default" ? choice : null);

/** What a choice changes, drawn like the sidebar: groups in order (▾ open, ▸ folded) and the first setup steps. */
function ChoicePreview({ choice }: { choice: Choice }) {
  const persona = toPersona(choice);
  const layout = sidebarLayout(persona);
  const steps = stepOrder(persona).slice(0, 3);
  return (
    <span className="mt-5 grid grid-cols-2 gap-4 border-t pt-4 text-xs">
      <span className="block">
        <span className="mb-2 block font-medium text-muted-foreground">Sidebar</span>
        <span className="block space-y-1">
          {layout.order.map((group) => {
            const isOpen = layout.expanded === null || layout.expanded === group;
            const Chevron = isOpen ? ChevronDown : ChevronRight;
            return (
              <span key={group} className={`flex items-center gap-1.5 ${isOpen ? "text-foreground" : "text-muted-foreground"}`}>
                <Chevron className="size-3.5 shrink-0" aria-hidden="true" />
                {group}
                {isOpen ? <span className="sr-only">(open)</span> : null}
              </span>
            );
          })}
        </span>
      </span>
      <span className="block">
        <span className="mb-2 block font-medium text-muted-foreground">Setup starts with</span>
        <span className="block space-y-1">
          {steps.map((step, index) => (
            <span key={step} className="flex items-center gap-1.5 text-foreground">
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              {SETUP_STEP_SHORT_LABEL[step]}
            </span>
          ))}
        </span>
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
  // Change mode always has a current choice: the saved persona, or "A bit of everything" when there is none.
  const [choice, setChoice] = useState<Choice | null>(mode === "change" ? initialPersona ?? "default" : null);
  const save = useSavePersona();

  // Live preview: picking a card writes it into the cached preferences the sidebar reads, so the sidebar
  // reorders at once. Nothing is saved until Save; leaving without saving puts the original back.
  const queryClient = useQueryClient();
  const original = useRef<UserPreferencesDto | null>(null);
  const saved = useRef(false);
  const restore = () => {
    if (!saved.current && original.current) queryClient.setQueryData(USER_PREFERENCES_QUERY_KEY, original.current);
  };
  const preview = (next: Choice) => {
    const current = queryClient.getQueryData<UserPreferencesDto>(USER_PREFERENCES_QUERY_KEY);
    if (!current) return;
    original.current ??= current;
    queryClient.setQueryData<UserPreferencesDto>(USER_PREFERENCES_QUERY_KEY, { ...current, persona: toPersona(next) });
  };
  useEffect(() => {
    const state = { original, saved };
    return () => {
      if (!state.saved.current && state.original.current) queryClient.setQueryData(USER_PREFERENCES_QUERY_KEY, state.original.current);
    };
  }, [queryClient]);

  const submit = (value: UserPersona | null) =>
    save.mutate(value, {
      onSuccess: () => {
        saved.current = true;
        onDone();
      },
      onError: () => toast.error("Could not save your choice. Try again."),
    });

  const title =
    mode === "creator"
      ? "Welcome to Supercheck"
      : mode === "change"
        ? "Choose your focus"
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
        onValueChange={(value) => {
          if (value !== "default" && !isUserPersona(value)) return;
          setChoice(value);
          preview(value);
        }}
        className="grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3"
      >
        {OPTIONS.map((option) => (
          <label
            key={option.id}
            htmlFor={`persona-${option.id}`}
            className="flex h-full cursor-pointer flex-col rounded-xl border border-border/60 bg-card p-6 transition-all hover:border-primary/70 hover:shadow-md has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-accent has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring"
          >
            <span className="flex items-start gap-4">
              <IconChip icon={option.icon} tone={option.tone} size="lg" />
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold leading-tight">{option.title}</span>
                <span className="mt-2 block text-sm leading-relaxed text-muted-foreground">{option.description}</span>
              </span>
              <RadioGroupItem id={`persona-${option.id}`} value={option.id} className="mt-1" />
            </span>
            <span className="mt-auto block">
              <ChoicePreview choice={option.id} />
            </span>
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
          <Button
            variant="ghost"
            disabled={save.isPending}
            onClick={() => {
              restore();
              onDone();
            }}
          >
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
