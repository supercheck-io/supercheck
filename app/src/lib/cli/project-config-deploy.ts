import type {
  NotificationProviderType,
  PlainNotificationProviderConfig,
} from "@/db/schema";
import {
  normalizeProviderConfig,
  validateProviderConfig,
} from "@/lib/notification-providers/validation";
import {
  SRE_INTEGRATION_CORRELATION_STRATEGIES,
  SRE_INTEGRATION_KEYS,
  type SreIntegrationCorrelationStrategy,
  type SreIntegrationKey,
} from "@/lib/sre/integration-bindings";

const NOTIFICATION_PROVIDER_TYPES = [
  "email",
  "slack",
  "webhook",
  "telegram",
  "discord",
  "teams",
] as const satisfies readonly NotificationProviderType[];

export type CliProjectConfigDeployProviderPlan = {
  index: number;
  id: string | null;
  name: string;
  type: NotificationProviderType;
  enabled: boolean | null;
  action: "create" | "update";
  configFieldNames: string[];
};

export type CliProjectConfigDeployBindingPlan = {
  index: number;
  id: string | null;
  integrationKey: SreIntegrationKey;
  correlationStrategy: SreIntegrationCorrelationStrategy;
  enabled: boolean;
  notificationProviderId: string;
  externalConnectorId: string;
  serviceIds: string[];
  action: "create" | "update";
};

export type CliProjectConfigDeployPlan = {
  mode: "dry_run" | "apply";
  notificationProviders: CliProjectConfigDeployProviderPlan[];
  sreIntegrationBindings: CliProjectConfigDeployBindingPlan[];
};

export type CliProjectConfigDeployError = {
  path: string;
  message: string;
};

export type CliProjectConfigDeployValidationResult = {
  valid: boolean;
  errors: CliProjectConfigDeployError[];
  warnings: string[];
  plan: CliProjectConfigDeployPlan;
  normalizedNotificationProviders: Array<{
    index: number;
    id: string | null;
    name: string;
    type: NotificationProviderType;
    enabled: boolean | null;
    config: PlainNotificationProviderConfig;
  }>;
};

export function analyzeCliProjectConfigDeployRequest(
  rawInput: unknown,
): CliProjectConfigDeployValidationResult {
  const errors: CliProjectConfigDeployError[] = [];
  const warnings = [
    "Deploy payloads must include explicit secret values. Redacted pull/diff snapshots are rejected to prevent secret erasure.",
  ];

  if (!isRecord(rawInput)) {
    return buildDeployValidationResult({
      errors: [{ path: "$", message: "Request body must be a JSON object." }],
      warnings,
    });
  }

  const mode = rawInput.mode === "apply" ? "apply" : "dry_run";
  if (mode === "dry_run") {
    warnings.unshift("Dry-run only: no notification providers or SRE bindings were modified.");
  }
  if (
    rawInput.mode !== undefined &&
    rawInput.mode !== "dry_run" &&
    rawInput.mode !== "apply"
  ) {
    errors.push({
      path: "$.mode",
      message: "Mode must be either dry_run or apply.",
    });
  }

  if (rawInput.schemaVersion !== undefined || rawInput.hashVersion !== undefined) {
    errors.push({
      path: "$",
      message:
        "Redacted project-config snapshots cannot be deployed. Send an explicit deploy payload with full provider config values.",
    });
  }

  const rawProviders = readOptionalArray(
    rawInput.notificationProviders,
    "$.notificationProviders",
    errors,
  );
  const rawBindings = readOptionalArray(
    rawInput.sreIntegrationBindings,
    "$.sreIntegrationBindings",
    errors,
  );

  const providerPlans: CliProjectConfigDeployProviderPlan[] = [];
  const normalizedNotificationProviders: CliProjectConfigDeployValidationResult["normalizedNotificationProviders"] = [];
  rawProviders.forEach((provider, index) => {
    const result = analyzeProvider(provider, index);
    errors.push(...result.errors);

    if (result.plan && result.normalizedProvider) {
      providerPlans.push(result.plan);
      normalizedNotificationProviders.push(result.normalizedProvider);
    }
  });

  const bindingPlans: CliProjectConfigDeployBindingPlan[] = [];
  rawBindings.forEach((binding, index) => {
    const result = analyzeBinding(binding, index);
    errors.push(...result.errors);
    if (result.plan) {
      bindingPlans.push(result.plan);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    plan: {
      mode,
      notificationProviders: providerPlans,
      sreIntegrationBindings: bindingPlans,
    },
    normalizedNotificationProviders,
  };
}

function analyzeProvider(
  rawProvider: unknown,
  index: number,
): {
  errors: CliProjectConfigDeployError[];
  plan: CliProjectConfigDeployProviderPlan | null;
  normalizedProvider: CliProjectConfigDeployValidationResult["normalizedNotificationProviders"][number] | null;
} {
  const path = `$.notificationProviders[${index}]`;
  const errors: CliProjectConfigDeployError[] = [];

  if (!isRecord(rawProvider)) {
    return {
      errors: [{ path, message: "Notification provider must be a JSON object." }],
      plan: null,
      normalizedProvider: null,
    };
  }

  if (rawProvider.configSummary !== undefined) {
    errors.push({
      path: `${path}.configSummary`,
      message:
        "Redacted configSummary is pull/diff output only and cannot be deployed.",
    });
  }

  const id = readOptionalString(rawProvider.id, `${path}.id`, errors);
  const name = readRequiredString(rawProvider.name, `${path}.name`, errors);
  const type = readNotificationProviderType(rawProvider.type, `${path}.type`, errors);
  const enabled = readOptionalBoolean(
    rawProvider.enabled ?? rawProvider.isEnabled,
    `${path}.enabled`,
    errors,
  );

  if (!isRecord(rawProvider.config)) {
    errors.push({
      path: `${path}.config`,
      message:
        "Explicit provider config is required for deploy preflight. Do not send redacted pull/diff snapshots.",
    });
  }

  if (!name || !type || !isRecord(rawProvider.config)) {
    return { errors, plan: null, normalizedProvider: null };
  }

  let normalizedConfig: PlainNotificationProviderConfig | null = null;
  try {
    validateProviderConfig(type, rawProvider.config);
    normalizedConfig = normalizeProviderConfig(
      type,
      rawProvider.config,
    ) as PlainNotificationProviderConfig;
  } catch (error) {
    errors.push({
      path: `${path}.config`,
      message:
        error instanceof Error
          ? error.message
          : "Provider config is invalid.",
    });
  }

  if (!normalizedConfig) {
    return { errors, plan: null, normalizedProvider: null };
  }

  return {
    errors,
    plan: {
      index,
      id,
      name,
      type,
      enabled,
      action: id ? "update" : "create",
      configFieldNames: Object.keys(normalizedConfig).sort(),
    },
    normalizedProvider: {
      index,
      id,
      name,
      type,
      enabled,
      config: normalizedConfig,
    },
  };
}

function analyzeBinding(
  rawBinding: unknown,
  index: number,
): {
  errors: CliProjectConfigDeployError[];
  plan: CliProjectConfigDeployBindingPlan | null;
} {
  const path = `$.sreIntegrationBindings[${index}]`;
  const errors: CliProjectConfigDeployError[] = [];

  if (!isRecord(rawBinding)) {
    return {
      errors: [{ path, message: "SRE integration binding must be a JSON object." }],
      plan: null,
    };
  }

  if (rawBinding.externalConnector !== undefined) {
    errors.push({
      path: `${path}.externalConnector`,
      message:
        "Redacted snapshot connector objects cannot be deployed. Use externalConnectorId.",
    });
  }

  const id = readOptionalString(rawBinding.id, `${path}.id`, errors);
  const integrationKey = readIntegrationKey(
    rawBinding.integrationKey,
    `${path}.integrationKey`,
    errors,
  );
  const correlationStrategy = readCorrelationStrategy(
    rawBinding.correlationStrategy,
    `${path}.correlationStrategy`,
    errors,
  );
  const enabled =
    readOptionalBoolean(rawBinding.enabled, `${path}.enabled`, errors) ?? true;
  const notificationProviderId = readRequiredString(
    rawBinding.notificationProviderId,
    `${path}.notificationProviderId`,
    errors,
  );
  const externalConnectorId = readRequiredString(
    rawBinding.externalConnectorId,
    `${path}.externalConnectorId`,
    errors,
  );
  const serviceIds = readStringArray(
    rawBinding.serviceIds,
    `${path}.serviceIds`,
    errors,
  );

  if (
    !integrationKey ||
    !correlationStrategy ||
    !notificationProviderId ||
    !externalConnectorId
  ) {
    return { errors, plan: null };
  }

  return {
    errors,
    plan: {
      index,
      id,
      integrationKey,
      correlationStrategy,
      enabled,
      notificationProviderId,
      externalConnectorId,
      serviceIds: [...new Set(serviceIds)].sort(),
      action: id ? "update" : "create",
    },
  };
}

function buildDeployValidationResult(input: {
  errors: CliProjectConfigDeployError[];
  warnings: string[];
}): CliProjectConfigDeployValidationResult {
  return {
    valid: false,
    errors: input.errors,
    warnings: input.warnings,
    plan: {
      mode: "dry_run",
      notificationProviders: [],
      sreIntegrationBindings: [],
    },
    normalizedNotificationProviders: [],
  };
}

function readOptionalArray(
  value: unknown,
  path: string,
  errors: CliProjectConfigDeployError[],
): unknown[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    errors.push({ path, message: "Expected an array." });
    return [];
  }

  return value;
}

function readStringArray(
  value: unknown,
  path: string,
  errors: CliProjectConfigDeployError[],
): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    errors.push({ path, message: "Expected an array of strings." });
    return [];
  }

  const invalidIndex = value.findIndex((entry) => typeof entry !== "string");
  if (invalidIndex >= 0) {
    errors.push({
      path: `${path}[${invalidIndex}]`,
      message: "Expected a string.",
    });
    return [];
  }

  return value.map((entry) => entry.trim()).filter(Boolean);
}

function readRequiredString(
  value: unknown,
  path: string,
  errors: CliProjectConfigDeployError[],
): string | null {
  const parsed = readOptionalString(value, path, errors);
  if (!parsed) {
    errors.push({ path, message: "Expected a non-empty string." });
  }
  return parsed;
}

function readOptionalString(
  value: unknown,
  path: string,
  errors: CliProjectConfigDeployError[],
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    errors.push({ path, message: "Expected a string." });
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOptionalBoolean(
  value: unknown,
  path: string,
  errors: CliProjectConfigDeployError[],
): boolean | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "boolean") {
    errors.push({ path, message: "Expected a boolean." });
    return null;
  }

  return value;
}

function readNotificationProviderType(
  value: unknown,
  path: string,
  errors: CliProjectConfigDeployError[],
): NotificationProviderType | null {
  if (
    typeof value === "string" &&
    NOTIFICATION_PROVIDER_TYPES.includes(value as NotificationProviderType)
  ) {
    return value as NotificationProviderType;
  }

  errors.push({ path, message: "Unsupported notification provider type." });
  return null;
}

function readIntegrationKey(
  value: unknown,
  path: string,
  errors: CliProjectConfigDeployError[],
): SreIntegrationKey | null {
  if (
    typeof value === "string" &&
    SRE_INTEGRATION_KEYS.includes(value as SreIntegrationKey)
  ) {
    return value as SreIntegrationKey;
  }

  errors.push({ path, message: "Unsupported SRE integration key." });
  return null;
}

function readCorrelationStrategy(
  value: unknown,
  path: string,
  errors: CliProjectConfigDeployError[],
): SreIntegrationCorrelationStrategy | null {
  if (
    typeof value === "string" &&
    SRE_INTEGRATION_CORRELATION_STRATEGIES.includes(
      value as SreIntegrationCorrelationStrategy,
    )
  ) {
    return value as SreIntegrationCorrelationStrategy;
  }

  errors.push({ path, message: "Unsupported correlation strategy." });
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
