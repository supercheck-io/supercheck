// The worker keeps a copy in worker/src/execution/services/spending-limit.ts; keep the rules identical.
export type SpendingLimitSource = "plan_default" | "custom";

export interface StoredSpendingLimit {
  spendingLimitSource: string;
  enableSpendingLimit: boolean;
  monthlySpendingLimitCents: number | null;
  hardStopOnLimit: boolean;
}

export interface EffectiveSpendingLimit {
  source: SpendingLimitSource;
  enabled: boolean;
  limitCents: number | null;
  hardStop: boolean;
  /** The plan's default cap, shown so owners can see what "plan default" means. */
  planDefaultCents: number | null;
}

/**
 * Paid plans start with a hard-stop cap at the plan default. An owner-set cap
 * ("custom", including disabled) wins. A missing settings row follows the plan default.
 */
export function resolveSpendingLimit(
  settings: StoredSpendingLimit | null | undefined,
  plan: string | null | undefined,
  planDefaultCents: number | null | undefined,
): EffectiveSpendingLimit {
  const planDefault =
    (plan === "plus" || plan === "pro") && Number.isInteger(planDefaultCents) && (planDefaultCents as number) > 0
      ? (planDefaultCents as number)
      : null;
  // A stored cap without the custom marker was saved by an app version older than this rule.
  const custom = settings?.spendingLimitSource === "custom" ||
    (!!settings && (settings.enableSpendingLimit || settings.monthlySpendingLimitCents !== null));
  if (settings && custom) {
    return {
      source: "custom",
      enabled: settings.enableSpendingLimit,
      limitCents: settings.monthlySpendingLimitCents,
      hardStop: settings.hardStopOnLimit,
      planDefaultCents: planDefault,
    };
  }
  return {
    source: "plan_default",
    enabled: planDefault !== null,
    limitCents: planDefault,
    hardStop: planDefault !== null,
    planDefaultCents: planDefault,
  };
}
