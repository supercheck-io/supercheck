/**
 * Project setup flag registry (spec D14, owner decision 2026-11-16: code only, no env vars).
 * A card or checklist item whose flag is false is neither rendered nor counted.
 * A feature's build PR flips its own entry; nothing else needs to change.
 */
export const SETUP_FEATURES = {
  setup: true,
  repeatUntilAck: true, // alerting base (#904)
  warningAlerts: true, // heartbeat + warning-only (#909)
  heartbeat: true, // #909
  aiEndpoint: true, // AI endpoint preset (#903)
  mcpMonitor: true, // MCP Monitor (#908)
  agentTest: true, // Agent test (#911)
  codingRecipe: true, // coding-agent recipe (#903)
  maintenance: true, // maintenance windows (#910)
  aiTests: true, // project setup PR B (scan + suggested requirements)
  aiSre: true, // project setup PR B (AI SRE step)
  mobile: false, // mobile app, session 16
} as const;

export type SetupFeature = keyof typeof SETUP_FEATURES;
export type SetupFeatures = Record<SetupFeature, boolean>;

/** Features that call a model need a configured AI provider (D19). */
const AI_FEATURES: readonly SetupFeature[] = ["aiTests", "aiSre"];

export function resolveSetupFeatures(opts: {
  aiConfigured: boolean;
  registry?: Readonly<SetupFeatures>;
}): SetupFeatures {
  const registry = opts.registry ?? SETUP_FEATURES;
  const resolved = { ...registry } as SetupFeatures;
  if (!resolved.setup) {
    for (const key of Object.keys(resolved) as SetupFeature[]) resolved[key] = false;
    return resolved;
  }
  if (!opts.aiConfigured) for (const key of AI_FEATURES) resolved[key] = false;
  return resolved;
}
