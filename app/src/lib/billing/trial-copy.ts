import catalog from "./plan-catalog.json";

type TrialLimits = typeof catalog.trial.limits;
type TrialValues = TrialLimits & { durationDays: number };

/** The numbers trial copy may mention, taken from the plan catalog so the text can never disagree with the limits. */
export function trialValues(source: typeof catalog.trial = catalog.trial): TrialValues {
  return {
    ...source.limits,
    durationDays: source.durationDays,
  };
}

/** Replaces every `{name}` in the text; an unknown name is an error, never a silent blank. */
export function fillTrialText(text: string, values: TrialValues = trialValues()): string {
  return text.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = (values as Record<string, unknown>)[name];
    if (value === undefined) throw new Error(`Unknown trial copy placeholder: {${name}}`);
    return String(value);
  });
}

/** The trial questions and answers shown on the pricing pages (app and docs). */
export function trialFaqs(): Array<{ question: string; answer: string }> {
  return catalog.trial.faqs.map((faq) => ({ question: faq.question, answer: fillTrialText(faq.answer) }));
}

/** Short list for the trial card. */
export function trialHighlights(values: TrialValues = trialValues()): string[] {
  return [
    `${values.maxMonitors} monitors, checked at most every ${values.minCheckIntervalMinutes} minutes`,
    `${values.maxStatusPages} status pages with up to ${values.maxStatusPageSubscribers} subscribers each`,
    `${values.playwrightMinutes} browser minutes for Playwright tests and synthetic monitors`,
    `k6 load tests of up to ${values.k6MaxVus} virtual users per run (${values.k6VuMinutes} virtual-user minutes in total)`,
    `${values.sreInvestigations} AI SRE investigations, ${values.triageRuns} AI triage runs and ${values.aiCredits} AI credits (AI SRE chat and evidence briefs are on paid plans)`,
    `${values.maxTeamMembers} team members and ${values.maxProjects} projects`,
  ];
}
